const { DynamoDBDocumentClient, ScanCommand, DeleteCommand, BatchWriteCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { compress, decompress, formatDate, generateMonthlyS3Key } = require('/opt/nodejs/utils');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const s3Client = new S3Client({});

const HOT_DATA_TABLE = process.env.HOT_DATA_TABLE;
const DATA_BUCKET = process.env.DATA_BUCKET;

/**
 * Archive Lambda handler - moves old data from DynamoDB to S3
 * Triggered daily by EventBridge
 */
exports.handler = async (event) => {
  console.log('Archive event:', JSON.stringify(event, null, 2));

  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 7); // Archive data older than 7 days
    const cutoffTimestamp = cutoffDate.getTime();
    const cutoffDateStr = formatDate(cutoffDate);

    console.log(`Archiving data older than ${cutoffDateStr} (${cutoffTimestamp})`);

    // Scan for old data
    const oldItems = await scanOldData(cutoffTimestamp);
    console.log(`Found ${oldItems.length} items to archive`);

    if (oldItems.length === 0) {
      return { message: 'No data to archive' };
    }

    // Group by client and month
    const groupedData = groupByClientAndMonth(oldItems);

    // Archive each group
    let archivedCount = 0;
    let deletedCount = 0;

    for (const [clientId, monthGroups] of Object.entries(groupedData)) {
      for (const [yearMonth, items] of Object.entries(monthGroups)) {
        try {
          await archiveMonthData(clientId, yearMonth, items);

          // Delete from DynamoDB
          await deleteArchivedItems(items);

          archivedCount += items.length;
          deletedCount += items.length;

          console.log(`Archived and deleted ${items.length} items for ${clientId}/${yearMonth}`);
        } catch (error) {
          console.error(`Error archiving ${clientId}/${yearMonth}:`, error);
        }
      }
    }

    return {
      message: `Archive completed: ${archivedCount} items archived, ${deletedCount} items deleted from hot storage`,
      archivedCount,
      deletedCount
    };
  } catch (error) {
    console.error('Archive handler error:', error);
    throw error;
  }
};

/**
 * Scan for old data in DynamoDB
 */
async function scanOldData(cutoffTimestamp) {
  const items = [];
  let lastEvaluatedKey;

  do {
    const response = await dynamoClient.send(new ScanCommand({
      TableName: HOT_DATA_TABLE,
      FilterExpression: 'SK = :sk AND lastModified < :cutoff',
      ExpressionAttributeValues: {
        ':sk': 'data',
        ':cutoff': cutoffTimestamp
      },
      ExclusiveStartKey: lastEvaluatedKey
    }));

    items.push(...response.Items);
    lastEvaluatedKey = response.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return items;
}

/**
 * Group items by client and year-month
 */
function groupByClientAndMonth(items) {
  const grouped = {};

  items.forEach(item => {
    const { clientId, date } = item;
    const yearMonth = date.substring(0, 6);

    if (!grouped[clientId]) {
      grouped[clientId] = {};
    }
    if (!grouped[clientId][yearMonth]) {
      grouped[clientId][yearMonth] = [];
    }

    grouped[clientId][yearMonth].push(item);
  });

  return grouped;
}

/**
 * Archive month data to S3
 */
async function archiveMonthData(clientId, yearMonth, items) {
  const s3Key = generateMonthlyS3Key(clientId, yearMonth);

  try {
    // Try to get existing data
    let existingData = {};

    try {
      const existing = await s3Client.send(new GetObjectCommand({
        Bucket: DATA_BUCKET,
        Key: s3Key
      }));

      const compressed = await streamToString(existing.Body);
      existingData = decompress(compressed);
    } catch (error) {
      if (error.name !== 'NoSuchKey') {
        console.warn(`Warning reading existing data for ${s3Key}:`, error);
      }
    }

    // Merge with new data
    items.forEach(item => {
      const recordKey = `${item.date}_${item.host}`;
      existingData[recordKey] = {
        host: item.host,
        date: item.date,
        focus: item.focus,
        time: item.time,
        lastModified: item.lastModified,
        sessionId: item.sessionId,
        archivedAt: Date.now()
      };
    });

    // Compress and save to S3
    const compressed = compress(existingData);
    await s3Client.send(new PutObjectCommand({
      Bucket: DATA_BUCKET,
      Key: s3Key,
      Body: compressed,
      ContentType: 'application/gzip',
      ContentEncoding: 'gzip',
      Metadata: {
        clientId,
        yearMonth,
        recordCount: Object.keys(existingData).length.toString(),
        lastArchived: new Date().toISOString()
      }
    }));

    console.log(`Successfully archived ${items.length} items to ${s3Key}`);
  } catch (error) {
    console.error(`Error archiving to ${s3Key}:`, error);
    throw error;
  }
}



/**
 * Delete archived items from DynamoDB
 */
async function deleteArchivedItems(items) {
  // DynamoDB batch delete supports max 25 items
  const batches = [];
  for (let i = 0; i < items.length; i += 25) {
    batches.push(items.slice(i, i + 25));
  }

  for (const batch of batches) {
    const deleteRequests = batch.map(item => ({
      DeleteRequest: {
        Key: {
          PK: item.PK,
          SK: item.SK
        }
      }
    }));

    try {
      await dynamoClient.send(new BatchWriteCommand({
        RequestItems: {
          [HOT_DATA_TABLE]: deleteRequests
        }
      }));
    } catch (error) {
      console.error('Error deleting batch:', error);
      // Try individual deletes for this batch
      for (const item of batch) {
        try {
          await dynamoClient.send(new DeleteCommand({
            TableName: HOT_DATA_TABLE,
            Key: {
              PK: item.PK,
              SK: item.SK
            }
          }));
        } catch (deleteError) {
          console.error(`Error deleting item ${item.PK}:`, deleteError);
        }
      }
    }
  }
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