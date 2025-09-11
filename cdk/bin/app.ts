#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WebTimeTrackerStack } from '../lib/web-time-tracker-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

new WebTimeTrackerStack(app, 'WebTimeTrackerStack', {
  env,
  description: 'Web Time Tracker Real-time Sync Infrastructure',
});