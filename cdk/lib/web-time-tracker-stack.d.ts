import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export declare class WebTimeTrackerStack extends cdk.Stack {
    readonly apiEndpoint: string;
    readonly websocketEndpoint: string;
    constructor(scope: Construct, id: string, props?: cdk.StackProps);
}
