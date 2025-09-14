"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WebTimeTrackerStack = void 0;
const cdk = require("aws-cdk-lib");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const s3 = require("aws-cdk-lib/aws-s3");
const lambda = require("aws-cdk-lib/aws-lambda");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const iam = require("aws-cdk-lib/aws-iam");
const apigatewayv2 = require("aws-cdk-lib/aws-apigatewayv2");
const integrations = require("aws-cdk-lib/aws-apigatewayv2-integrations");
const logs = require("aws-cdk-lib/aws-logs");
class WebTimeTrackerStack extends cdk.Stack {
    apiEndpoint;
    websocketEndpoint;
    constructor(scope, id, props) {
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
exports.WebTimeTrackerStack = WebTimeTrackerStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoid2ViLXRpbWUtdHJhY2tlci1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIndlYi10aW1lLXRyYWNrZXItc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLHFEQUFxRDtBQUNyRCx5Q0FBeUM7QUFDekMsaURBQWlEO0FBQ2pELHlEQUF5RDtBQUN6RCxpREFBaUQ7QUFDakQsMERBQTBEO0FBQzFELDJDQUEyQztBQUMzQyw2REFBNkQ7QUFDN0QsMEVBQTBFO0FBQzFFLDZDQUE2QztBQUc3QyxNQUFhLG1CQUFvQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ2hDLFdBQVcsQ0FBUztJQUNwQixpQkFBaUIsQ0FBUztJQUUxQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXNCO1FBQzlELEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLDZCQUE2QjtRQUM3QixNQUFNLFVBQVUsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2pFLFVBQVUsRUFBRSx5QkFBeUIsSUFBSSxDQUFDLE9BQU8sSUFBSSxJQUFJLENBQUMsTUFBTSxFQUFFO1lBQ2xFLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU8sRUFBRSxrQ0FBa0M7WUFDNUUsaUJBQWlCLEVBQUUsSUFBSSxFQUFFLHdCQUF3QjtZQUNqRCxTQUFTLEVBQUUsSUFBSTtZQUNmLGNBQWMsRUFBRSxDQUFDO29CQUNmLEVBQUUsRUFBRSxvQkFBb0I7b0JBQ3hCLE9BQU8sRUFBRSxJQUFJO29CQUNiLDRCQUE0QixFQUFFLENBQUM7NEJBQzdCLFlBQVksRUFBRSxFQUFFLENBQUMsWUFBWSxDQUFDLE9BQU87NEJBQ3JDLGVBQWUsRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUM7eUJBQ3ZDLENBQUM7aUJBQ0gsQ0FBQztZQUNG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QUU7WUFDckMsS0FBSyxFQUFFLElBQUksQ0FBQyxXQUFXO1lBQ3ZCLFdBQVcsRUFBRSx1Q0FBdUM7U0FDckQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGlCQUFpQjtZQUM3QixXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsVUFBVSxFQUFFO1lBQ2xDLEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztZQUNuQixXQUFXLEVBQUUsK0JBQStCO1NBQzdDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxVQUFVLENBQUMsVUFBVTtZQUM1QixXQUFXLEVBQUUsNEJBQTRCO1NBQzFDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxZQUFZLENBQUMsU0FBUztZQUM3QixXQUFXLEVBQUUsNkJBQTZCO1NBQzNDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXBXRCxrREFvV0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xyXG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5djIgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXl2Mic7XHJcbmltcG9ydCAqIGFzIGludGVncmF0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheXYyLWludGVncmF0aW9ucyc7XHJcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuXHJcbmV4cG9ydCBjbGFzcyBXZWJUaW1lVHJhY2tlclN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcclxuICBwdWJsaWMgcmVhZG9ubHkgYXBpRW5kcG9pbnQ6IHN0cmluZztcclxuICBwdWJsaWMgcmVhZG9ubHkgd2Vic29ja2V0RW5kcG9pbnQ6IHN0cmluZztcclxuXHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgLy8gUzMgQnVja2V0IGZvciBjb2xkIHN0b3JhZ2VcclxuICAgIGNvbnN0IGRhdGFCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdXZWJUaW1lVHJhY2tlckRhdGFCdWNrZXQnLCB7XHJcbiAgICAgIGJ1Y2tldE5hbWU6IGB3ZWItdGltZS10cmFja2VyLWRhdGEtJHt0aGlzLmFjY291bnR9LSR7dGhpcy5yZWdpb259YCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gQ2hhbmdlIHRvIFJFVEFJTiBmb3IgcHJvZHVjdGlvblxyXG4gICAgICBhdXRvRGVsZXRlT2JqZWN0czogdHJ1ZSwgLy8gUmVtb3ZlIGZvciBwcm9kdWN0aW9uXHJcbiAgICAgIHZlcnNpb25lZDogdHJ1ZSxcclxuICAgICAgbGlmZWN5Y2xlUnVsZXM6IFt7XHJcbiAgICAgICAgaWQ6ICdBcmNoaXZlT2xkVmVyc2lvbnMnLFxyXG4gICAgICAgIGVuYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgbm9uY3VycmVudFZlcnNpb25UcmFuc2l0aW9uczogW3tcclxuICAgICAgICAgIHN0b3JhZ2VDbGFzczogczMuU3RvcmFnZUNsYXNzLkdMQUNJRVIsXHJcbiAgICAgICAgICB0cmFuc2l0aW9uQWZ0ZXI6IGNkay5EdXJhdGlvbi5kYXlzKDMwKSxcclxuICAgICAgICB9XSxcclxuICAgICAgfV0sXHJcbiAgICAgIGNvcnM6IFt7XHJcbiAgICAgICAgYWxsb3dlZEhlYWRlcnM6IFsnKiddLFxyXG4gICAgICAgIGFsbG93ZWRNZXRob2RzOiBbXHJcbiAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5HRVQsXHJcbiAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5QVVQsXHJcbiAgICAgICAgICBzMy5IdHRwTWV0aG9kcy5QT1NULFxyXG4gICAgICAgICAgczMuSHR0cE1ldGhvZHMuREVMRVRFLFxyXG4gICAgICAgIF0sXHJcbiAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnKiddLCAvLyBSZXN0cmljdCBpbiBwcm9kdWN0aW9uXHJcbiAgICAgICAgbWF4QWdlOiAzMDAwLFxyXG4gICAgICB9XSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIER5bmFtb0RCIFRhYmxlIGZvciBob3QgZGF0YSAobGFzdCA3IGRheXMpXHJcbiAgICBjb25zdCBob3REYXRhVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ1dlYlRpbWVUcmFja2VySG90RGF0YScsIHtcclxuICAgICAgdGFibGVOYW1lOiAnV2ViVGltZVRyYWNrZXJIb3REYXRhJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ1BLJywgLy8ge2NsaWVudElkfSN7aG9zdH0je2RhdGV9XHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIHNvcnRLZXk6IHtcclxuICAgICAgICBuYW1lOiAnU0snLCAvLyBkYXRhIHwgbWV0YWRhdGFcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSwgLy8gQ2hhbmdlIHRvIFJFVEFJTiBmb3IgcHJvZHVjdGlvblxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5U3BlY2lmaWNhdGlvbjoge1xyXG4gICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlLFxyXG4gICAgICB9LFxyXG4gICAgICBzdHJlYW06IGR5bmFtb2RiLlN0cmVhbVZpZXdUeXBlLk5FV19BTkRfT0xEX0lNQUdFUyxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHbG9iYWwgU2Vjb25kYXJ5IEluZGV4IGZvciBxdWVyeWluZyBieSBjbGllbnRcclxuICAgIGhvdERhdGFUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ0NsaWVudEluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2NsaWVudElkJyxcclxuICAgICAgICB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyxcclxuICAgICAgfSxcclxuICAgICAgc29ydEtleToge1xyXG4gICAgICAgIG5hbWU6ICdsYXN0TW9kaWZpZWQnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuTlVNQkVSLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR2xvYmFsIFNlY29uZGFyeSBJbmRleCBmb3IgcXVlcnlpbmcgYnkgZGF0ZSByYW5nZVxyXG4gICAgaG90RGF0YVRhYmxlLmFkZEdsb2JhbFNlY29uZGFyeUluZGV4KHtcclxuICAgICAgaW5kZXhOYW1lOiAnRGF0ZUluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2RhdGUnLFxyXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HLFxyXG4gICAgICB9LFxyXG4gICAgICBzb3J0S2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2xhc3RNb2RpZmllZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5OVU1CRVIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBEeW5hbW9EQiBUYWJsZSBmb3IgY2xpZW50IGNvbm5lY3Rpb25zIChXZWJTb2NrZXQpXHJcbiAgICBjb25zdCBjb25uZWN0aW9uc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdXZWJUaW1lVHJhY2tlckNvbm5lY3Rpb25zJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdXZWJUaW1lVHJhY2tlckNvbm5lY3Rpb25zJyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7XHJcbiAgICAgICAgbmFtZTogJ2Nvbm5lY3Rpb25JZCcsXHJcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkcsXHJcbiAgICAgIH0sXHJcbiAgICAgIGJpbGxpbmdNb2RlOiBkeW5hbW9kYi5CaWxsaW5nTW9kZS5QQVlfUEVSX1JFUVVFU1QsXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICAgIHRpbWVUb0xpdmVBdHRyaWJ1dGU6ICd0dGwnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIExheWVyIGZvciBzaGFyZWQgZGVwZW5kZW5jaWVzXHJcbiAgICBjb25zdCBzaGFyZWRMYXllciA9IG5ldyBsYW1iZGEuTGF5ZXJWZXJzaW9uKHRoaXMsICdXZWJUaW1lVHJhY2tlclNoYXJlZExheWVyJywge1xyXG4gICAgICBsYXllclZlcnNpb25OYW1lOiAnd2ViLXRpbWUtdHJhY2tlci1zaGFyZWQnLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS1sYXllcnMvc2hhcmVkJyksXHJcbiAgICAgIGNvbXBhdGlibGVSdW50aW1lczogW2xhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YXSxcclxuICAgICAgZGVzY3JpcHRpb246ICdTaGFyZWQgZGVwZW5kZW5jaWVzIGZvciBXZWIgVGltZSBUcmFja2VyIGxhbWJkYXMnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgY3VzdG9tIGJ1c1xyXG4gICAgY29uc3QgZXZlbnRCdXMgPSBuZXcgZXZlbnRzLkV2ZW50QnVzKHRoaXMsICdXZWJUaW1lVHJhY2tlckV2ZW50QnVzJywge1xyXG4gICAgICBldmVudEJ1c05hbWU6ICdXZWJUaW1lVHJhY2tlckV2ZW50cycsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBMb2cgZ3JvdXBzIGZvciBMYW1iZGEgZnVuY3Rpb25zXHJcbiAgICBjb25zdCBzeW5jTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnU3luY0Z1bmN0aW9uTG9nR3JvdXAnLCB7XHJcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL1dlYlRpbWVUcmFja2VyLVN5bmNGdW5jdGlvbicsXHJcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYXJjaGl2ZUxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0FyY2hpdmVGdW5jdGlvbkxvZ0dyb3VwJywge1xyXG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS9XZWJUaW1lVHJhY2tlci1BcmNoaXZlRnVuY3Rpb24nLFxyXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcclxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHdlYnNvY2tldExvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ1dlYlNvY2tldEZ1bmN0aW9uTG9nR3JvdXAnLCB7XHJcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL1dlYlRpbWVUcmFja2VyLVdlYlNvY2tldEZ1bmN0aW9uJyxcclxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXHJcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBub3RpZnlMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdOb3RpZnlGdW5jdGlvbkxvZ0dyb3VwJywge1xyXG4gICAgICBsb2dHcm91cE5hbWU6ICcvYXdzL2xhbWJkYS9XZWJUaW1lVHJhY2tlci1Ob3RpZnlGdW5jdGlvbicsXHJcbiAgICAgIHJldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxyXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uc1xyXG4gICAgY29uc3Qgc3luY0xhbWJkYSA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1N5bmNGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnV2ViVGltZVRyYWNrZXItU3luY0Z1bmN0aW9uJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIGhhbmRsZXI6ICdzeW5jLmhhbmRsZXInLFxyXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYS9zeW5jJyksXHJcbiAgICAgIGxheWVyczogW3NoYXJlZExheWVyXSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBIT1RfREFUQV9UQUJMRTogaG90RGF0YVRhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgICBEQVRBX0JVQ0tFVDogZGF0YUJ1Y2tldC5idWNrZXROYW1lLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgICAgQ09OTkVDVElPTlNfVEFCTEU6IGNvbm5lY3Rpb25zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDUxMixcclxuICAgICAgbG9nR3JvdXA6IHN5bmNMb2dHcm91cCxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFyY2hpdmVMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdBcmNoaXZlRnVuY3Rpb24nLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1dlYlRpbWVUcmFja2VyLUFyY2hpdmVGdW5jdGlvbicsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18yMF9YLFxyXG4gICAgICBoYW5kbGVyOiAnYXJjaGl2ZS5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEvYXJjaGl2ZScpLFxyXG4gICAgICBsYXllcnM6IFtzaGFyZWRMYXllcl0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgSE9UX0RBVEFfVEFCTEU6IGhvdERhdGFUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgREFUQV9CVUNLRVQ6IGRhdGFCdWNrZXQuYnVja2V0TmFtZSxcclxuICAgICAgfSxcclxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxyXG4gICAgICBtZW1vcnlTaXplOiAxMDI0LFxyXG4gICAgICBsb2dHcm91cDogYXJjaGl2ZUxvZ0dyb3VwLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgd2Vic29ja2V0TGFtYmRhID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnV2ViU29ja2V0RnVuY3Rpb24nLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ1dlYlRpbWVUcmFja2VyLVdlYlNvY2tldEZ1bmN0aW9uJyxcclxuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzIwX1gsXHJcbiAgICAgIGhhbmRsZXI6ICd3ZWJzb2NrZXQuaGFuZGxlcicsXHJcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnbGFtYmRhL3dlYnNvY2tldCcpLFxyXG4gICAgICBsYXllcnM6IFtzaGFyZWRMYXllcl0sXHJcbiAgICAgIGVudmlyb25tZW50OiB7XHJcbiAgICAgICAgQ09OTkVDVElPTlNfVEFCTEU6IGNvbm5lY3Rpb25zVGFibGUudGFibGVOYW1lLFxyXG4gICAgICAgIEVWRU5UX0JVU19OQU1FOiBldmVudEJ1cy5ldmVudEJ1c05hbWUsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcclxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxyXG4gICAgICBsb2dHcm91cDogd2Vic29ja2V0TG9nR3JvdXAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBub3RpZnlMYW1iZGEgPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdOb3RpZnlGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnV2ViVGltZVRyYWNrZXItTm90aWZ5RnVuY3Rpb24nLFxyXG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMjBfWCxcclxuICAgICAgaGFuZGxlcjogJ25vdGlmeS5oYW5kbGVyJyxcclxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdsYW1iZGEvbm90aWZ5JyksXHJcbiAgICAgIGxheWVyczogW3NoYXJlZExheWVyXSxcclxuICAgICAgZW52aXJvbm1lbnQ6IHtcclxuICAgICAgICBDT05ORUNUSU9OU19UQUJMRTogY29ubmVjdGlvbnNUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgICAgLy8gV2ViU29ja2V0IGVuZHBvaW50IHdpbGwgYmUgYWRkZWQgYWZ0ZXIgV2ViU29ja2V0IEFQSSBjcmVhdGlvblxyXG4gICAgICB9LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgbG9nR3JvdXA6IG5vdGlmeUxvZ0dyb3VwLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnNcclxuICAgIGhvdERhdGFUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoc3luY0xhbWJkYSk7XHJcbiAgICBob3REYXRhVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKGFyY2hpdmVMYW1iZGEpO1xyXG4gICAgZGF0YUJ1Y2tldC5ncmFudFJlYWRXcml0ZShzeW5jTGFtYmRhKTtcclxuICAgIGRhdGFCdWNrZXQuZ3JhbnRSZWFkV3JpdGUoYXJjaGl2ZUxhbWJkYSk7XHJcbiAgICBldmVudEJ1cy5ncmFudFB1dEV2ZW50c1RvKHN5bmNMYW1iZGEpO1xyXG4gICAgY29ubmVjdGlvbnNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEod2Vic29ja2V0TGFtYmRhKTtcclxuICAgIGNvbm5lY3Rpb25zVGFibGUuZ3JhbnRSZWFkV3JpdGVEYXRhKG5vdGlmeUxhbWJkYSk7XHJcblxyXG4gICAgLy8gR3JhbnQgV2ViU29ja2V0IEFQSSBwZXJtaXNzaW9ucyB0byBub3RpZnkgbGFtYmRhXHJcbiAgICBub3RpZnlMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ2V4ZWN1dGUtYXBpOk1hbmFnZUNvbm5lY3Rpb25zJ1xyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFsnKiddLCAvLyBXaWxsIGJlIHVwZGF0ZWQgYWZ0ZXIgV2ViU29ja2V0IEFQSSBpcyBjcmVhdGVkXHJcbiAgICB9KSk7XHJcblxyXG4gICAgLy8gUkVTVCBBUEkgR2F0ZXdheVxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnV2ViVGltZVRyYWNrZXJBcGknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnV2ViIFRpbWUgVHJhY2tlciBTeW5jIEFQSScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciBXZWIgVGltZSBUcmFja2VyIHJlYWwtdGltZSBzeW5jJyxcclxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XHJcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXHJcbiAgICAgICAgYWxsb3dNZXRob2RzOiBhcGlnYXRld2F5LkNvcnMuQUxMX01FVEhPRFMsXHJcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbXHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJyxcclxuICAgICAgICAgICdYLUFtei1EYXRlJyxcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJyxcclxuICAgICAgICAgICdYLUFwaS1LZXknLFxyXG4gICAgICAgICAgJ1gtQW16LVNlY3VyaXR5LVRva2VuJyxcclxuICAgICAgICAgICdYLUNsaWVudC1JZCcsXHJcbiAgICAgICAgXSxcclxuICAgICAgfSxcclxuICAgICAgYXBpS2V5U291cmNlVHlwZTogYXBpZ2F0ZXdheS5BcGlLZXlTb3VyY2VUeXBlLkhFQURFUixcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFQSSBpbnRlZ3JhdGlvblxyXG4gICAgY29uc3Qgc3luY0ludGVncmF0aW9uID0gbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oc3luY0xhbWJkYSwge1xyXG4gICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7ICdhcHBsaWNhdGlvbi9qc29uJzogJ3sgXCJzdGF0dXNDb2RlXCI6IFwiMjAwXCIgfScgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFQSSByZXNvdXJjZXNcclxuICAgIGNvbnN0IHN5bmNSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdzeW5jJyk7XHJcbiAgICBzeW5jUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgc3luY0ludGVncmF0aW9uKTtcclxuICAgIHN5bmNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIHN5bmNJbnRlZ3JhdGlvbik7XHJcblxyXG4gICAgY29uc3QgZGF0YVJlc291cmNlID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2RhdGEnKTtcclxuICAgIGRhdGFSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIHN5bmNJbnRlZ3JhdGlvbik7XHJcbiAgICBkYXRhUmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBzeW5jSW50ZWdyYXRpb24pO1xyXG5cclxuICAgIC8vIFdlYlNvY2tldCBBUEkgR2F0ZXdheVxyXG4gICAgY29uc3Qgd2Vic29ja2V0QXBpID0gbmV3IGFwaWdhdGV3YXl2Mi5XZWJTb2NrZXRBcGkodGhpcywgJ1dlYlRpbWVUcmFja2VyV2ViU29ja2V0Jywge1xyXG4gICAgICBhcGlOYW1lOiAnV2ViIFRpbWUgVHJhY2tlciBXZWJTb2NrZXQgQVBJJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdXZWJTb2NrZXQgQVBJIGZvciByZWFsLXRpbWUgc3luYyBub3RpZmljYXRpb25zJyxcclxuICAgICAgY29ubmVjdFJvdXRlT3B0aW9uczoge1xyXG4gICAgICAgIGludGVncmF0aW9uOiBuZXcgaW50ZWdyYXRpb25zLldlYlNvY2tldExhbWJkYUludGVncmF0aW9uKCdDb25uZWN0SW50ZWdyYXRpb24nLCB3ZWJzb2NrZXRMYW1iZGEpLFxyXG4gICAgICB9LFxyXG4gICAgICBkaXNjb25uZWN0Um91dGVPcHRpb25zOiB7XHJcbiAgICAgICAgaW50ZWdyYXRpb246IG5ldyBpbnRlZ3JhdGlvbnMuV2ViU29ja2V0TGFtYmRhSW50ZWdyYXRpb24oJ0Rpc2Nvbm5lY3RJbnRlZ3JhdGlvbicsIHdlYnNvY2tldExhbWJkYSksXHJcbiAgICAgIH0sXHJcbiAgICAgIGRlZmF1bHRSb3V0ZU9wdGlvbnM6IHtcclxuICAgICAgICBpbnRlZ3JhdGlvbjogbmV3IGludGVncmF0aW9ucy5XZWJTb2NrZXRMYW1iZGFJbnRlZ3JhdGlvbignRGVmYXVsdEludGVncmF0aW9uJywgd2Vic29ja2V0TGFtYmRhKSxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHdlYnNvY2tldFN0YWdlID0gbmV3IGFwaWdhdGV3YXl2Mi5XZWJTb2NrZXRTdGFnZSh0aGlzLCAnV2ViU29ja2V0U3RhZ2UnLCB7XHJcbiAgICAgIHdlYlNvY2tldEFwaTogd2Vic29ja2V0QXBpLFxyXG4gICAgICBzdGFnZU5hbWU6ICdwcm9kJyxcclxuICAgICAgYXV0b0RlcGxveTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFVwZGF0ZSBXZWJTb2NrZXQgcGVybWlzc2lvbnMgd2l0aCBhY3R1YWwgQVJOXHJcbiAgICBub3RpZnlMYW1iZGEuYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcclxuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxyXG4gICAgICBhY3Rpb25zOiBbXHJcbiAgICAgICAgJ2V4ZWN1dGUtYXBpOk1hbmFnZUNvbm5lY3Rpb25zJ1xyXG4gICAgICBdLFxyXG4gICAgICByZXNvdXJjZXM6IFtcclxuICAgICAgICBgYXJuOmF3czpleGVjdXRlLWFwaToke3RoaXMucmVnaW9ufToke3RoaXMuYWNjb3VudH06JHt3ZWJzb2NrZXRBcGkuYXBpSWR9LyR7d2Vic29ja2V0U3RhZ2Uuc3RhZ2VOYW1lfS8qYFxyXG4gICAgICBdLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIC8vIEFkZCBXZWJTb2NrZXQgZW5kcG9pbnQgdG8gbm90aWZ5IGxhbWJkYSBlbnZpcm9ubWVudFxyXG4gICAgbm90aWZ5TGFtYmRhLmFkZEVudmlyb25tZW50KCdXRUJTT0NLRVRfRU5EUE9JTlQnLCB3ZWJzb2NrZXRTdGFnZS51cmwpO1xyXG5cclxuICAgIC8vIEV2ZW50QnJpZGdlIHJ1bGVzXHJcbiAgICBjb25zdCBkYXRhQ2hhbmdlUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnRGF0YUNoYW5nZVJ1bGUnLCB7XHJcbiAgICAgIGV2ZW50QnVzLFxyXG4gICAgICBldmVudFBhdHRlcm46IHtcclxuICAgICAgICBzb3VyY2U6IFsnd2ViLXRpbWUtdHJhY2tlciddLFxyXG4gICAgICAgIGRldGFpbFR5cGU6IFsnRGF0YSBVcGRhdGVkJ10sXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBkYXRhQ2hhbmdlUnVsZS5hZGRUYXJnZXQobmV3IHRhcmdldHMuTGFtYmRhRnVuY3Rpb24obm90aWZ5TGFtYmRhKSk7XHJcblxyXG4gICAgLy8gU2NoZWR1bGVkIGFyY2hpdmluZyBydWxlIChydW5zIGRhaWx5IGF0IDIgQU0pXHJcbiAgICBjb25zdCBhcmNoaXZlUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnQXJjaGl2ZVJ1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XHJcbiAgICAgICAgbWludXRlOiAnMCcsXHJcbiAgICAgICAgaG91cjogJzInLFxyXG4gICAgICAgIGRheTogJyonLFxyXG4gICAgICAgIG1vbnRoOiAnKicsXHJcbiAgICAgICAgeWVhcjogJyonLFxyXG4gICAgICB9KSxcclxuICAgIH0pO1xyXG5cclxuICAgIGFyY2hpdmVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihhcmNoaXZlTGFtYmRhKSk7XHJcblxyXG4gICAgLy8gQVBJIEtleSBmb3IgZXh0ZW5zaW9uIGF1dGhlbnRpY2F0aW9uXHJcbiAgICBjb25zdCBhcGlLZXkgPSBhcGkuYWRkQXBpS2V5KCdXZWJUaW1lVHJhY2tlckFwaUtleScsIHtcclxuICAgICAgYXBpS2V5TmFtZTogJ3dlYi10aW1lLXRyYWNrZXItZXh0ZW5zaW9uLWtleScsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGtleSBmb3IgV2ViIFRpbWUgVHJhY2tlciBicm93c2VyIGV4dGVuc2lvbicsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCB1c2FnZVBsYW4gPSBhcGkuYWRkVXNhZ2VQbGFuKCdXZWJUaW1lVHJhY2tlclVzYWdlUGxhbicsIHtcclxuICAgICAgbmFtZTogJ3dlYi10aW1lLXRyYWNrZXItdXNhZ2UtcGxhbicsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnVXNhZ2UgcGxhbiBmb3IgV2ViIFRpbWUgVHJhY2tlciBBUEknLFxyXG4gICAgICB0aHJvdHRsZToge1xyXG4gICAgICAgIHJhdGVMaW1pdDogMTAwMCxcclxuICAgICAgICBidXJzdExpbWl0OiAyMDAwLFxyXG4gICAgICB9LFxyXG4gICAgICBxdW90YToge1xyXG4gICAgICAgIGxpbWl0OiAxMDAwMDAsXHJcbiAgICAgICAgcGVyaW9kOiBhcGlnYXRld2F5LlBlcmlvZC5NT05USCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHVzYWdlUGxhbi5hZGRBcGlLZXkoYXBpS2V5KTtcclxuICAgIHVzYWdlUGxhbi5hZGRBcGlTdGFnZSh7XHJcbiAgICAgIHN0YWdlOiBhcGkuZGVwbG95bWVudFN0YWdlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgdGhpcy5hcGlFbmRwb2ludCA9IGFwaS51cmw7XHJcbiAgICB0aGlzLndlYnNvY2tldEVuZHBvaW50ID0gd2Vic29ja2V0U3RhZ2UudXJsO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlFbmRwb2ludCcsIHtcclxuICAgICAgdmFsdWU6IHRoaXMuYXBpRW5kcG9pbnQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnV2ViIFRpbWUgVHJhY2tlciBBUEkgR2F0ZXdheSBlbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2ViU29ja2V0RW5kcG9pbnQnLCB7XHJcbiAgICAgIHZhbHVlOiB0aGlzLndlYnNvY2tldEVuZHBvaW50LFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1dlYiBUaW1lIFRyYWNrZXIgV2ViU29ja2V0IEFQSSBlbmRwb2ludCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpS2V5SWQnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGlLZXkua2V5SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEtleSBJRCBmb3IgYXV0aGVudGljYXRpb24nLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RhdGFCdWNrZXQnLCB7XHJcbiAgICAgIHZhbHVlOiBkYXRhQnVja2V0LmJ1Y2tldE5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IGZvciBkYXRhIHN0b3JhZ2UnLFxyXG4gICAgfSk7XHJcblxyXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0hvdERhdGFUYWJsZScsIHtcclxuICAgICAgdmFsdWU6IGhvdERhdGFUYWJsZS50YWJsZU5hbWUsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgdGFibGUgZm9yIGhvdCBkYXRhJyxcclxuICAgIH0pO1xyXG4gIH1cclxufSJdfQ==