const { DynamoDBDocumentClient, PutCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { generateTTL } = require('/opt/nodejs/utils');

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const CONNECTIONS_TABLE = process.env.CONNECTIONS_TABLE;

/**
 * WebSocket Lambda handler
 */
exports.handler = async (event) => {
  console.log('WebSocket event:', JSON.stringify(event, null, 2));
  
  const { eventType, connectionId } = event.requestContext || {};
  const routeKey = event.requestContext?.routeKey;
  
  try {
    switch (eventType || routeKey) {
      case 'CONNECT':
      case '$connect':
        return await handleConnect(connectionId, event);
      case 'DISCONNECT':
      case '$disconnect':
        return await handleDisconnect(connectionId);
      case 'MESSAGE':
      case '$default':
        return await handleMessage(connectionId, event);
      default:
        console.log('Unknown event type:', eventType || routeKey);
        return { statusCode: 200 };
    }
  } catch (error) {
    console.error('WebSocket handler error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
};

/**
 * Handle WebSocket connection
 */
async function handleConnect(connectionId, event) {
  const { headers, queryStringParameters } = event;
  const clientId = queryStringParameters?.clientId || headers?.['x-client-id'];
  
  if (!clientId) {
    console.error('No client ID provided for connection');
    return {
      statusCode: 400,
      body: 'Client ID required'
    };
  }
  
  try {
    // Store connection info
    await dynamoClient.send(new PutCommand({
      TableName: CONNECTIONS_TABLE,
      Item: {
        connectionId,
        clientId,
        connectedAt: Date.now(),
        ttl: generateTTL(1) // 1 day TTL for connections
      }
    }));
    
    console.log(`Client ${clientId} connected with connection ${connectionId}`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Connected successfully' })
    };
  } catch (error) {
    console.error('Connection error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to connect' })
    };
  }
}

/**
 * Handle WebSocket disconnection
 */
async function handleDisconnect(connectionId) {
  try {
    await dynamoClient.send(new DeleteCommand({
      TableName: CONNECTIONS_TABLE,
      Key: { connectionId }
    }));
    
    console.log(`Connection ${connectionId} disconnected`);
    
    return {
      statusCode: 200,
      body: 'Disconnected'
    };
  } catch (error) {
    console.error('Disconnection error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to disconnect' })
    };
  }
}

/**
 * Handle WebSocket messages
 */
async function handleMessage(connectionId, event) {
  try {
    const body = JSON.parse(event.body || '{}');
    const { action, data } = body;
    
    console.log(`Received message from ${connectionId}:`, { action, data });
    
    switch (action) {
      case 'ping':
        return {
          statusCode: 200,
          body: JSON.stringify({ action: 'pong', timestamp: Date.now() })
        };
      case 'subscribe':
        // Handle subscription to specific data updates
        return await handleSubscribe(connectionId, data);
      default:
        return {
          statusCode: 200,
          body: JSON.stringify({ error: 'Unknown action' })
        };
    }
  } catch (error) {
    console.error('Message handling error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message })
    };
  }
}

/**
 * Handle subscription requests
 */
async function handleSubscribe(connectionId, data) {
  // In a real implementation, you might store subscription preferences
  // For now, just acknowledge the subscription
  return {
    statusCode: 200,
    body: JSON.stringify({ 
      action: 'subscribed', 
      subscriptions: data?.topics || ['data-updates']
    })
  };
}