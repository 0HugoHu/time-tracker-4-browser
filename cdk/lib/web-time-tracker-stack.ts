import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class WebTimeTrackerStack extends cdk.Stack {
  public readonly apiEndpoint: string;
  public readonly websocketEndpoint: string;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for cold storage
    const dataBucket = new s3.Bucket(this, 'WebTimeTrackerDataBucket', {
      bucketName: `web-time-tracker-data-${this.account}-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      autoDeleteObjects: true, // Remove for production
      versioned: true,
      lifecycleRules: [{
        id: 'ArchiveOldVersions',
        enabled: true,
        noncurrentVersionTransitions: [{
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(30),
        }],
      }],
      cors: [{
        allowedHeaders: ['*'],
        allowedMethods: [
          s3.HttpMethods.GET,
          s3.HttpMethods.PUT,
          s3.HttpMethods.POST,
          s3.HttpMethods.DELETE,
        ],
        allowedOrigins: ['*'], // Restrict in production
        maxAge: 3000,
      }],
    });

    // DynamoDB Table for hot data (last 7 days)
    const hotDataTable = new dynamodb.Table(this, 'WebTimeTrackerHotData', {
      tableName: 'WebTimeTrackerHotData',
      partitionKey: {
        name: 'PK', // {clientId}#{host}#{date}
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'SK', // data | metadata
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN for production
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      timeToLiveAttribute: 'ttl',
    });

    // Global Secondary Index for querying by client
    hotDataTable.addGlobalSecondaryIndex({
      indexName: 'ClientIndex',
      partitionKey: {
        name: 'clientId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lastModified',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // Global Secondary Index for querying by date range
    hotDataTable.addGlobalSecondaryIndex({
      indexName: 'DateIndex',
      partitionKey: {
        name: 'date',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'lastModified',
        type: dynamodb.AttributeType.NUMBER,
      },
    });

    // DynamoDB Table for client connections (WebSocket)
    const connectionsTable = new dynamodb.Table(this, 'WebTimeTrackerConnections', {
      tableName: 'WebTimeTrackerConnections',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    // Lambda Layer for shared dependencies
    const sharedLayer = new lambda.LayerVersion(this, 'WebTimeTrackerSharedLayer', {
      layerVersionName: 'web-time-tracker-shared',
      code: lambda.Code.fromAsset('lambda-layers/shared'),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X],
      description: 'Shared dependencies for Web Time Tracker lambdas',
    });

    // EventBridge custom bus
    const eventBus = new events.EventBus(this, 'WebTimeTrackerEventBus', {
      eventBusName: 'WebTimeTrackerEvents',
    });

    // Log groups for Lambda functions
    const syncLogGroup = new logs.LogGroup(this, 'SyncFunctionLogGroup', {
      logGroupName: '/aws/lambda/WebTimeTracker-SyncFunction',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const archiveLogGroup = new logs.LogGroup(this, 'ArchiveFunctionLogGroup', {
      logGroupName: '/aws/lambda/WebTimeTracker-ArchiveFunction',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const websocketLogGroup = new logs.LogGroup(this, 'WebSocketFunctionLogGroup', {
      logGroupName: '/aws/lambda/WebTimeTracker-WebSocketFunction',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const notifyLogGroup = new logs.LogGroup(this, 'NotifyFunctionLogGroup', {
      logGroupName: '/aws/lambda/WebTimeTracker-NotifyFunction',
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda functions
    const syncLambda = new lambda.Function(this, 'SyncFunction', {
      functionName: 'WebTimeTracker-SyncFunction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'sync.handler',
      code: lambda.Code.fromAsset('lambda/sync'),
      layers: [sharedLayer],
      environment: {
        HOT_DATA_TABLE: hotDataTable.tableName,
        DATA_BUCKET: dataBucket.bucketName,
        EVENT_BUS_NAME: eventBus.eventBusName,
        CONNECTIONS_TABLE: connectionsTable.tableName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      logGroup: syncLogGroup,
    });

    const archiveLambda = new lambda.Function(this, 'ArchiveFunction', {
      functionName: 'WebTimeTracker-ArchiveFunction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'archive.handler',
      code: lambda.Code.fromAsset('lambda/archive'),
      layers: [sharedLayer],
      environment: {
        HOT_DATA_TABLE: hotDataTable.tableName,
        DATA_BUCKET: dataBucket.bucketName,
      },
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      logGroup: archiveLogGroup,
    });

    const websocketLambda = new lambda.Function(this, 'WebSocketFunction', {
      functionName: 'WebTimeTracker-WebSocketFunction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'websocket.handler',
      code: lambda.Code.fromAsset('lambda/websocket'),
      layers: [sharedLayer],
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: websocketLogGroup,
    });

    const notifyLambda = new lambda.Function(this, 'NotifyFunction', {
      functionName: 'WebTimeTracker-NotifyFunction',
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'notify.handler',
      code: lambda.Code.fromAsset('lambda/notify'),
      layers: [sharedLayer],
      environment: {
        CONNECTIONS_TABLE: connectionsTable.tableName,
        // WebSocket endpoint will be added after WebSocket API creation
      },
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      logGroup: notifyLogGroup,
    });

    // Grant permissions
    hotDataTable.grantReadWriteData(syncLambda);
    hotDataTable.grantReadWriteData(archiveLambda);
    dataBucket.grantReadWrite(syncLambda);
    dataBucket.grantReadWrite(archiveLambda);
    eventBus.grantPutEventsTo(syncLambda);
    connectionsTable.grantReadWriteData(websocketLambda);
    connectionsTable.grantReadWriteData(notifyLambda);

    // Grant WebSocket API permissions to notify lambda
    notifyLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections'
      ],
      resources: ['*'], // Will be updated after WebSocket API is created
    }));

    // REST API Gateway
    const api = new apigateway.RestApi(this, 'WebTimeTrackerApi', {
      restApiName: 'Web Time Tracker Sync API',
      description: 'API for Web Time Tracker real-time sync',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Client-Id',
        ],
      },
      apiKeySourceType: apigateway.ApiKeySourceType.HEADER,
    });

    // API integration
    const syncIntegration = new apigateway.LambdaIntegration(syncLambda, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
    });

    // API resources
    const syncResource = api.root.addResource('sync');
    syncResource.addMethod('POST', syncIntegration);
    syncResource.addMethod('GET', syncIntegration);

    const dataResource = api.root.addResource('data');
    dataResource.addMethod('GET', syncIntegration);
    dataResource.addMethod('PUT', syncIntegration);

    // WebSocket API Gateway
    const websocketApi = new apigatewayv2.WebSocketApi(this, 'WebTimeTrackerWebSocket', {
      apiName: 'Web Time Tracker WebSocket API',
      description: 'WebSocket API for real-time sync notifications',
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', websocketLambda),
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', websocketLambda),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DefaultIntegration', websocketLambda),
      },
    });

    const websocketStage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: websocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Update WebSocket permissions with actual ARN
    notifyLambda.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'execute-api:ManageConnections'
      ],
      resources: [
        `arn:aws:execute-api:${this.region}:${this.account}:${websocketApi.apiId}/${websocketStage.stageName}/*`
      ],
    }));

    // Add WebSocket endpoint to notify lambda environment
    notifyLambda.addEnvironment('WEBSOCKET_ENDPOINT', websocketStage.url);

    // EventBridge rules
    const dataChangeRule = new events.Rule(this, 'DataChangeRule', {
      eventBus,
      eventPattern: {
        source: ['web-time-tracker'],
        detailType: ['Data Updated'],
      },
    });

    dataChangeRule.addTarget(new targets.LambdaFunction(notifyLambda));

    // Scheduled archiving rule (runs daily at 2 AM)
    const archiveRule = new events.Rule(this, 'ArchiveRule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*',
      }),
    });

    archiveRule.addTarget(new targets.LambdaFunction(archiveLambda));

    // API Key for extension authentication
    const apiKey = api.addApiKey('WebTimeTrackerApiKey', {
      apiKeyName: 'web-time-tracker-extension-key',
      description: 'API key for Web Time Tracker browser extension',
    });

    const usagePlan = api.addUsagePlan('WebTimeTrackerUsagePlan', {
      name: 'web-time-tracker-usage-plan',
      description: 'Usage plan for Web Time Tracker API',
      throttle: {
        rateLimit: 1000,
        burstLimit: 2000,
      },
      quota: {
        limit: 100000,
        period: apigateway.Period.MONTH,
      },
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      stage: api.deploymentStage,
    });

    // Outputs
    this.apiEndpoint = api.url;
    this.websocketEndpoint = websocketStage.url;

    new cdk.CfnOutput(this, 'ApiEndpoint', {
      value: this.apiEndpoint,
      description: 'Web Time Tracker API Gateway endpoint',
    });

    new cdk.CfnOutput(this, 'WebSocketEndpoint', {
      value: this.websocketEndpoint,
      description: 'Web Time Tracker WebSocket API endpoint',
    });

    new cdk.CfnOutput(this, 'ApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID for authentication',
    });

    new cdk.CfnOutput(this, 'DataBucket', {
      value: dataBucket.bucketName,
      description: 'S3 bucket for data storage',
    });

    new cdk.CfnOutput(this, 'HotDataTable', {
      value: hotDataTable.tableName,
      description: 'DynamoDB table for hot data',
    });
  }
}