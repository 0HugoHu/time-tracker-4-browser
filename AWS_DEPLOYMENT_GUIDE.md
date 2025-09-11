# AWS Real-time Sync Deployment Guide

## Overview

This guide helps you deploy the AWS real-time sync infrastructure for the Time Tracker browser extension. The solution provides:

- **Real-time sync** via WebSocket connections
- **Conflict resolution** for multi-device usage
- **Hot/Cold data architecture** for cost optimization
- **Automatic fallback** from WebSocket to polling
- **Background sync** with offline queue support

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Node.js 20+** installed locally
3. **AWS CDK** installed globally: `npm install -g aws-cdk`
4. **AWS CLI** configured with credentials

## Architecture

```
Browser Extensions → API Gateway → Lambda Functions
                                      ↓
                   DynamoDB (Hot Data) ← → S3 (Cold Storage)
                                      ↓
                   WebSocket API ← EventBridge → Notifications
```

**Data Lifecycle:**
- **Hot data** (last 7 days): DynamoDB for immediate access
- **Warm data** (7-30 days): DynamoDB + S3 daily files  
- **Cold data** (>30 days): S3 monthly files only

## Step 1: Deploy Infrastructure

### 1.1 Install CDK Dependencies

```bash
cd cdk
npm install
```

### 1.2 Bootstrap CDK (first time only)

```bash
cdk bootstrap
```

### 1.3 Deploy the Stack

```bash
# Build Lambda layers
cd lambda-layers/shared/nodejs
npm install
cd ../../..

# Deploy infrastructure
cdk deploy
```

### 1.4 Note the Outputs

Save these values from the deployment output:
- `ApiEndpoint`: REST API URL
- `WebSocketEndpoint`: WebSocket API URL  
- `ApiKeyId`: API Key ID for authentication
- `DataBucket`: S3 bucket name
- `HotDataTable`: DynamoDB table name

### 1.5 Get API Key Value

```bash
aws apigateway get-api-key --api-key <ApiKeyId> --include-value
```

## Step 2: Configure Extension

### 2.1 Open Extension Options

1. Go to `chrome://extensions/`
2. Find "Time Tracker" extension
3. Click "Options"
4. Navigate to "Backup" tab

### 2.2 Select AWS Sync

1. Change backup type to "AWS Real-time Sync"
2. Fill in the configuration:

| Field | Value | Example |
|-------|-------|---------|
| **API Key** | Value from Step 1.5 | `AbCdEf123456789` |
| **API Endpoint** | From deployment output | `https://abc123.execute-api.us-east-1.amazonaws.com/prod` |
| **WebSocket Endpoint** | From deployment output | `wss://def456.execute-api.us-east-1.amazonaws.com/prod` |
| **AWS Region** | Your deployment region | `us-east-1` |

3. Set **Client Name** to identify this device (e.g., "Work Laptop", "Home PC")
4. Enable **Auto Backup** for real-time sync

### 2.3 Test Connection

Click the test button to verify configuration. You should see:
- ✅ Connection successful
- ✅ WebSocket connected (if available)
- 📊 Sync status indicator

## Step 3: Verify Setup

### 3.1 Check Sync Status

In the extension options, you should see:
- **Hybrid Sync**: Connected via WebSocket or Polling fallback
- **Background Service**: Active with pending count
- **Last Sync**: Recent timestamp

### 3.2 Test Multi-Device Sync

1. Install extension on another device
2. Configure with same AWS credentials
3. Use different client name
4. Browse websites on one device
5. Verify data appears on other device within seconds

### 3.3 Monitor AWS Resources

Check AWS Console for:
- **DynamoDB**: Records appearing in `TimeTrackerHotData`
- **S3**: Files in `time-tracker-data-<account>-<region>` bucket
- **CloudWatch**: Lambda function logs and metrics

## Configuration Options

### Sweet Spot Thresholds (Optimized)

| Setting | Value | Reason |
|---------|--------|--------|
| **Hot Data TTL** | 7 days | Balance between speed and cost |
| **Archive Schedule** | Daily at 2 AM UTC | Off-peak processing |
| **Batch Size** | 50 rows | Optimal Lambda payload size |
| **Sync Interval** | 15 seconds | Real-time feel without overload |
| **Max Queue Size** | 1000 rows | Handle offline scenarios |
| **Retry Limit** | 3 attempts | Balance reliability vs. resource usage |
| **WebSocket Heartbeat** | 30 seconds | Keep connections alive |
| **Polling Fallback** | 30 seconds | When WebSocket unavailable |

### Cost Optimization

**Estimated Monthly Costs (heavy user - 1000 entries/day):**
- DynamoDB: $1-2 (read/write operations)
- S3: $0.50 (storage costs)
- Lambda: $0.50 (processing)
- API Gateway: $1 (API calls)
- **Total: ~$3-4/month per user**

**For lighter usage (100 entries/day): ~$0.50-1/month per user**

## Troubleshooting

### Common Issues

**1. "Connection failed" error**
- Verify API key is correct
- Check API endpoint URL format
- Ensure AWS region matches deployment

**2. "WebSocket connection timeout"**
- Corporate firewall may block WebSockets
- System will automatically fallback to polling
- Check WebSocket endpoint URL

**3. "No data syncing"**
- Verify auto backup is enabled
- Check background service status
- Look for errors in browser console

**4. High AWS costs**
- Review DynamoDB usage patterns
- Adjust archive schedule if needed
- Consider reducing sync frequency

### Debug Commands

```bash
# Check DynamoDB data
aws dynamodb scan --table-name TimeTrackerHotData --max-items 10

# List S3 objects
aws s3 ls s3://time-tracker-data-<account>-<region>/clients/ --recursive

# View Lambda logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/TimeTracker"
```

### Browser Console Debugging

Open browser DevTools and check for:
```javascript
// Check sync status
console.log('Sync Status:', backgroundSyncService.getStats())

// Force sync
await backgroundSyncService.forceSync()

// Check WebSocket connection
console.log('WebSocket Status:', hybridSyncManager.getStatus())
```

## Security Considerations

1. **API Keys**: Store securely, rotate regularly
2. **HTTPS Only**: All endpoints use SSL/TLS
3. **CORS**: Restricted to extension origins only
4. **DynamoDB**: Uses least-privilege IAM roles
5. **S3**: Private buckets with encryption at rest

## Maintenance

### Regular Tasks

1. **Monitor costs** via AWS Cost Explorer
2. **Check logs** for errors or unusual patterns  
3. **Rotate API keys** quarterly
4. **Update Lambda layers** when dependencies change
5. **Review S3 lifecycle policies** for old data

### Updates

To update the infrastructure:
```bash
cd cdk
cdk diff  # Preview changes
cdk deploy  # Apply changes
```

### Cleanup

To remove all AWS resources:
```bash
cd cdk
cdk destroy
```

**⚠️ Warning**: This will delete all sync data permanently!

## Support

For issues with:
- **Extension functionality**: Check browser extension logs
- **AWS infrastructure**: Review CloudWatch logs and AWS documentation
- **Cost optimization**: Use AWS Cost Explorer and Trusted Advisor
- **Performance**: Monitor CloudWatch metrics and DynamoDB insights

The hybrid sync system is designed to be resilient and automatically handle most common scenarios like network issues, browser closures, and temporary AWS service interruptions.