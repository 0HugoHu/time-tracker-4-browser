const { DynamoDBDocumentClient, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { ApiGatewayManagementApiClient, PostToConnectionCommand } = require('@aws-sdk/client-apigatewaymanagementapi');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/**
 * Notification Lambda handler - triggered by EventBridge
 */
exports.handler = async (event) => {
  console.log('Notify event:', JSON.stringify(event, null, 2));

  try {
    const { source, detail } = event;

    if (source !== 'web-time-tracker') {
      console.log('Ignoring non-web-time-tracker event');
      return;
    }

    const { clientIds, type, ...notificationData } = detail;

    // Get all active connections for the affected clients
    const connections = await getActiveConnections(clientIds);

    if (connections.length === 0) {
      console.log('No active connections to notify');
      return;
    }

    // Send notifications to all connections
    const results = await Promise.allSettled(
      connections.map(conn => sendNotification(conn, {
        type,
        ...notificationData,
        timestamp: new Date().toISOString()
      }))
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    console.log(`Notifications sent: ${successful} successful, ${failed} failed`);

    // Clean up stale connections
    const staleConnections = results
      .map((result, index) => ({ result, connection: connections[index] }))
      .filter(({ result }) => result.status === 'rejected' &&
               result.reason?.name === 'GoneException')
      .map(({ connection }) => connection);

    if (staleConnections.length > 0) {
      await cleanupStaleConnections(staleConnections);
    }

  } catch (error) {
    console.error('Notify handler error:', error);
  }
};

/**
 * Get active connections for specified clients
 */
async function getActiveConnections(clientIds) {
  const connections = [];

  try {
    let lastEvaluatedKey;
    do {
      const response = await dynamoClient.send(new ScanCommand({
        TableName: CONNECTIONS_TABLE,
        FilterExpression: 'clientId IN (' + clientIds.map((_, i) => `:client${i}`).join(',') + ')',
        ExpressionAttributeValues: clientIds.reduce((acc, clientId, i) => {
          acc[`:client${i}`] = clientId;
          return acc;
        }, {}),
        ExclusiveStartKey: lastEvaluatedKey
      }));

      connections.push(...response.Items);
      lastEvaluatedKey = response.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return connections;
  } catch (error) {
    console.error('Error getting active connections:', error);
    return [];
  }
}

/**
 * Send notification to a specific connection
 */
async function sendNotification(connection, notification) {
  const { connectionId } = connection;

  // Extract API Gateway endpoint from environment or connection info
  // In practice, you'd store this when the connection is established
  const endpoint = process.env.WEBSOCKET_ENDPOINT ||
                  `${connectionId.split('/')[0]}.execute-api.${process.env.AWS_REGION}.amazonaws.com/prod`;

  const apiGatewayClient = new ApiGatewayManagementApiClient({
    endpoint: `https://${endpoint}`
  });

  try {
    await apiGatewayClient.send(new PostToConnectionCommand({
      ConnectionId: connectionId,
      Data: JSON.stringify({
        event: 'sync-update',
        data: notification
      })
    }));

    console.log(`Notification sent to ${connectionId}`);
  } catch (error) {
    if (error.name === 'GoneException') {
      console.log(`Connection ${connectionId} is stale`);
    } else {
      console.error(`Failed to send to ${connectionId}:`, error);
    }
    throw error;
  }
}

/**
 * Clean up stale connections
 */
async function cleanupStaleConnections(staleConnections) {
  try {
    await Promise.all(staleConnections.map(conn =>
      dynamoClient.send(new DeleteCommand({
        TableName: CONNECTIONS_TABLE,
        Key: { connectionId: conn.connectionId }
      }))
    ));

    console.log(`Cleaned up ${staleConnections.length} stale connections`);
  } catch (error) {
    console.error('Error cleaning up stale connections:', error);
  }
}