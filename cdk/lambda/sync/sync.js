const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, QueryCommand, UpdateCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const {
  compress,
  decompress,
  generateTTL,
  formatDate,
  isHotData,
  generatePK,
  generateMonthlyS3Key,
  generateDailyS3Key
} = require('/opt/nodejs/utils');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});
const eventBridgeClient = new EventBridgeClient({});

const HOT_DATA_TABLE = process.env.HOT_DATA_TABLE;
const DATA_BUCKET = process.env.DATA_BUCKET;
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;

/**
 * Main handler for sync operations
 */
exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  const httpMethod = event.httpMethod || event.requestContext?.http?.method;
  const path = event.path || event.rawPath;

  try {
    let response;

    if (httpMethod === 'POST' && path.includes('/sync')) {
      response = await handleUpload(event);
    } else if (httpMethod === 'GET' && path.includes('/sync')) {
      response = await handleListClients(event);
    } else if (httpMethod === 'GET' && path.includes('/data')) {
      response = await handleDownload(event);
    } else if (httpMethod === 'PUT' && path.includes('/data')) {
      response = await handleUpdate(event);
    } else {
      response = {
        statusCode: 404,
        body: JSON.stringify({ error: 'Not found' })
      };
    }

    return {
      ...response,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token,X-Client-Id',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      }
    };
  } catch (error) {
    console.error('Handler error:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Handle data upload (real-time sync)
 */
async function handleUpload(event) {
  const body = JSON.parse(event.body);
  const clientId = event.headers['X-Client-Id'] || body.clientId;

  if (!clientId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Client ID required' })
    };
  }

  const { rows, batchId } = body;

  if (!rows || !Array.isArray(rows)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Rows array required' })
    };
  }

  const results = [];
  const affectedClients = new Set([clientId]);

  // Process each row
  for (const row of rows) {
    try {
      const result = await processRow(clientId, row, batchId);
      results.push(result);

      // Track affected clients for notifications
      if (result.conflicts) {
        result.conflicts.forEach(c => affectedClients.add(c.clientId));
      }
    } catch (error) {
      console.error(`Error processing row:`, error);
      results.push({
        error: error.message,
        row
      });
    }
  }

  // Send notification event for real-time sync
  if (results.some(r => r.success)) {
    await sendUpdateNotification(Array.from(affectedClients), {
      type: 'data-updated',
      clientId,
      batchId,
      updatedRows: results.filter(r => r.success).length
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true,
      processed: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => r.error).length,
      results
    })
  };
}

/**
 * Process individual row with conflict resolution
 */
async function processRow(clientId, row, batchId) {
  const { host, date, focus, time, sessionId, lastModified } = row;
  const pk = generatePK(clientId, host, date);
  const now = Date.now();

  try {
    // Check for existing data
    const existing = await dynamoClient.send(new GetCommand({
      TableName: HOT_DATA_TABLE,
      Key: { PK: pk, SK: 'data' }
    }));

    let finalData;
    let conflicts = [];

    if (existing.Item) {
      // Conflict resolution
      const conflictResult = await resolveConflict(existing.Item, {
        clientId,
        host,
        date,
        focus: focus || 0,
        time: time || 0,
        sessionId,
        lastModified: lastModified || now,
        batchId
      });

      finalData = conflictResult.resolved;
      conflicts = conflictResult.conflicts;
    } else {
      // New record
      finalData = {
        PK: pk,
        SK: 'data',
        clientId,
        host,
        date,
        focus: focus || 0,
        time: time || 0,
        sessionId,
        lastModified: lastModified || now,
        batchId,
        version: 1,
        ttl: generateTTL(7)
      };
    }

    // Save to DynamoDB
    await dynamoClient.send(new PutCommand({
      TableName: HOT_DATA_TABLE,
      Item: finalData,
      ConditionExpression: 'attribute_not_exists(PK) OR version < :newVersion',
      ExpressionAttributeValues: {
        ':newVersion': finalData.version
      }
    }));

    // Archive to S3 if not hot data
    if (!isHotData(date)) {
      await archiveToS3(clientId, finalData);
    }

    return {
      success: true,
      pk,
      version: finalData.version,
      conflicts
    };
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      // Version conflict - retry with latest data
      console.warn('Version conflict, retrying...', pk);
      return await processRow(clientId, row, batchId);
    }
    throw error;
  }
}

/**
 * Resolve conflicts between existing and new data
 */
async function resolveConflict(existing, incoming) {
  const conflicts = [];

  // Check if it's the same session
  if (existing.sessionId === incoming.sessionId) {
    // Same session - accumulate
    return {
      resolved: {
        ...existing,
        focus: existing.focus + incoming.focus,
        time: existing.time + incoming.time,
        lastModified: Math.max(existing.lastModified, incoming.lastModified),
        version: existing.version + 1,
        ttl: generateTTL(7)
      },
      conflicts
    };
  }

  // Different sessions - check timestamp and apply strategy
  if (incoming.lastModified > existing.lastModified) {
    // Newer data wins, but track conflict
    conflicts.push({
      type: 'session_conflict',
      clientId: existing.clientId,
      sessionId: existing.sessionId,
      overwritten: {
        focus: existing.focus,
        time: existing.time,
        lastModified: existing.lastModified
      }
    });

    // Strategy: Take maximum values (conservative approach)
    return {
      resolved: {
        ...existing,
        clientId: incoming.clientId, // Latest client wins
        sessionId: incoming.sessionId,
        focus: Math.max(existing.focus, incoming.focus),
        time: Math.max(existing.time, incoming.time),
        lastModified: incoming.lastModified,
        version: existing.version + 1,
        ttl: generateTTL(7),
        conflictResolution: 'max_values'
      },
      conflicts
    };
  } else {
    // Existing data is newer, reject update but track attempt
    conflicts.push({
      type: 'timestamp_conflict',
      clientId: incoming.clientId,
      sessionId: incoming.sessionId,
      rejected: true,
      reason: 'older_timestamp'
    });

    return {
      resolved: existing,
      conflicts
    };
  }
}

/**
 * Archive data to S3
 */
async function archiveToS3(clientId, data) {
  const { date } = data;
  const yearMonth = date.substring(0, 6);

  try {
    // Try to get existing monthly data
    let monthlyData = {};
    const monthlyKey = generateMonthlyS3Key(clientId, yearMonth);

    try {
      const existing = await s3Client.send(new GetObjectCommand({
        Bucket: DATA_BUCKET,
        Key: monthlyKey
      }));

      const compressed = await streamToString(existing.Body);
      monthlyData = decompress(compressed);
    } catch (error) {
      if (error.name !== 'NoSuchKey') {
        console.warn('Error reading existing S3 data:', error);
      }
    }

    // Add/update the record
    const recordKey = `${date}_${data.host}`;
    monthlyData[recordKey] = {
      host: data.host,
      date: data.date,
      focus: data.focus,
      time: data.time,
      lastModified: data.lastModified,
      sessionId: data.sessionId
    };

    // Compress and save
    const compressed = compress(monthlyData);
    await s3Client.send(new PutObjectCommand({
      Bucket: DATA_BUCKET,
      Key: monthlyKey,
      Body: compressed,
      ContentType: 'application/gzip',
      ContentEncoding: 'gzip',
      Metadata: {
        clientId,
        yearMonth,
        recordCount: Object.keys(monthlyData).length.toString()
      }
    }));

    console.log(`Archived data to S3: ${monthlyKey}`);
  } catch (error) {
    console.error('S3 archiving error:', error);
    // Don't fail the main operation for archiving errors
  }
}

/**
 * Handle client list request
 */
async function handleListClients(event) {
  try {
    // Query all unique clients from hot data
    const clients = new Map();

    // Scan the ClientIndex GSI to get all clients
    const response = await dynamoClient.send(new QueryCommand({
      TableName: HOT_DATA_TABLE,
      IndexName: 'ClientIndex',
      KeyConditionExpression: 'clientId = :clientId',
      ExpressionAttributeValues: {
        ':clientId': 'all' // This won't work - need to fix this approach
      }
    }));

    // TODO: Implement proper client listing logic
    // For now, return mock data
    return {
      statusCode: 200,
      body: JSON.stringify({
        clients: []
      })
    };
  } catch (error) {
    console.error('List clients error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Handle data download request
 */
async function handleDownload(event) {
  const { queryStringParameters } = event;
  const clientId = event.headers['X-Client-Id'];
  const startDate = queryStringParameters?.startDate;
  const endDate = queryStringParameters?.endDate;
  const targetClientId = queryStringParameters?.clientId;

  if (!clientId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'Client ID required' })
    };
  }

  try {
    const data = await downloadData(targetClientId || clientId, startDate, endDate);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        data,
        count: data.length
      })
    };
  } catch (error) {
    console.error('Download error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Download data for date range
 */
async function downloadData(clientId, startDate, endDate) {
  const result = [];
  const start = startDate ? new Date(startDate) : new Date('2020-01-01');
  const end = endDate ? new Date(endDate) : new Date();

  // Download from hot data (DynamoDB)
  const hotData = await downloadHotData(clientId, start, end);
  result.push(...hotData);

  // Download from cold data (S3) if needed
  if (start < new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)) {
    const coldData = await downloadColdData(clientId, start, end);
    result.push(...coldData);
  }

  // Deduplicate and sort
  const uniqueData = deduplicateRows(result);
  return uniqueData.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Download hot data from DynamoDB
 */
async function downloadHotData(clientId, startDate, endDate) {
  const result = [];
  const startDateStr = formatDate(startDate);
  const endDateStr = formatDate(endDate);

  // Query by date range using DateIndex
  let lastEvaluatedKey;
  do {
    const response = await dynamoClient.send(new QueryCommand({
      TableName: HOT_DATA_TABLE,
      IndexName: 'ClientIndex',
      KeyConditionExpression: 'clientId = :clientId AND lastModified BETWEEN :start AND :end',
      ExpressionAttributeValues: {
        ':clientId': clientId,
        ':start': startDate.getTime(),
        ':end': endDate.getTime()
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));

    result.push(...response.Items.filter(item =>
      item.SK === 'data' &&
      item.date >= startDateStr &&
      item.date <= endDateStr
    ));

    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return result.map(item => ({
    host: item.host,
    date: item.date,
    focus: item.focus,
    time: item.time
  }));
}

/**
 * Download cold data from S3
 */
async function downloadColdData(clientId, startDate, endDate) {
  const result = [];

  // Generate list of months to check
  const months = [];
  const current = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
  const endMonth = new Date(endDate.getFullYear(), endDate.getMonth(), 1);

  while (current <= endMonth) {
    months.push(formatDate(current).substring(0, 6));
    current.setMonth(current.getMonth() + 1);
  }

  // Download each month's data
  for (const yearMonth of months) {
    try {
      const monthlyKey = generateMonthlyS3Key(clientId, yearMonth);
      const response = await s3Client.send(new GetObjectCommand({
        Bucket: DATA_BUCKET,
        Key: monthlyKey
      }));

      const compressed = await streamToString(response.Body);
      const monthlyData = decompress(compressed);

      // Filter by date range
      Object.values(monthlyData).forEach(record => {
        const recordDate = new Date(record.date.slice(0, 4) + '-' + record.date.slice(4, 6) + '-' + record.date.slice(6, 8));
        if (recordDate >= startDate && recordDate <= endDate) {
          result.push({
            host: record.host,
            date: record.date,
            focus: record.focus,
            time: record.time
          });
        }
      });
    } catch (error) {
      if (error.name !== 'NoSuchKey') {
        console.warn(`Error downloading ${yearMonth}:`, error);
      }
    }
  }

  return result;
}

/**
 * Handle data update request
 */
async function handleUpdate(event) {
  // This would handle batch updates, similar to handleUpload
  // Implementation depends on specific requirements
  return {
    statusCode: 501,
    body: JSON.stringify({ error: 'Not implemented yet' })
  };
}

/**
 * Send update notification via EventBridge
 */
async function sendUpdateNotification(clientIds, updateData) {
  try {
    await eventBridgeClient.send(new PutEventsCommand({
      Entries: [{
        Source: 'web-time-tracker',
        DetailType: 'Data Updated',
        Detail: JSON.stringify({
          clientIds,
          ...updateData,
          timestamp: new Date().toISOString()
        }),
        EventBusName: EVENT_BUS_NAME
      }]
    }));
  } catch (error) {
    console.error('Failed to send notification:', error);
  }
}

/**
 * Deduplicate rows by host+date, keeping latest
 */
function deduplicateRows(rows) {
  const map = new Map();

  rows.forEach(row => {
    const key = `${row.host}#${row.date}`;
    const existing = map.get(key);

    if (!existing || row.lastModified > existing.lastModified) {
      map.set(key, row);
    }
  });

  return Array.from(map.values());
}

/**
 * Convert stream to string
 */
async function streamToString(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString();
}