# Time Tracker CDK Infrastructure

This directory contains the AWS CDK infrastructure code for the Time Tracker real-time sync system.

## Quick Start

1. Install dependencies:
```bash
npm install
```

2. Build Lambda layers:
```bash
cd lambda-layers/shared/nodejs
npm install
cd ../../..
```

3. Deploy:
```bash
cdk deploy
```

## Architecture

- **API Gateway**: REST API for sync operations
- **WebSocket API**: Real-time notifications
- **Lambda Functions**: Business logic
- **DynamoDB**: Hot data storage (7 days)
- **S3**: Cold data archival (>7 days)
- **EventBridge**: Event-driven notifications

## Lambda Functions

- `sync.js`: Handle upload/download operations
- `websocket.js`: Manage WebSocket connections  
- `notify.js`: Send real-time notifications
- `archive.js`: Move old data from DynamoDB to S3

## CDK Commands

- `cdk deploy`: Deploy infrastructure
- `cdk diff`: Preview changes
- `cdk synth`: Generate CloudFormation templates
- `cdk destroy`: Remove all resources

## Configuration

The stack creates:
- DynamoDB table with 7-day TTL
- S3 bucket with lifecycle policies
- Lambda functions with appropriate IAM roles
- API Gateway with usage plans and API keys
- WebSocket API for real-time connections

See `../AWS_DEPLOYMENT_GUIDE.md` for complete setup instructions.