import * as aws from '@pulumi/aws';
import type * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import { EcrImage } from './resources/image';
import {
  CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
  stack,
} from './resources/shared';

const BASE_NAME = 'pdf-preprocess-lambda';
const BASE_PATH = '../';
const PDF_PREPROCESS_LAMBDA_PATH = `${BASE_PATH}/pdf-preprocess-lambda`;

type PdfPreprocessLambdaArgs<T extends Record<string, any>> = {
  envVars: { [K in keyof T]: pulumi.Output<string> | string };
  docStorageBucketArn: pulumi.Output<string> | string;
  jobUpdateHandlerLambdaArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: string;
    publicSubnetIds: string[];
    privateSubnetIds: string[];
  };
  tags: { [key: string]: string };
};

export class PdfPreprocessLambda<
  T extends Record<string, any>,
> extends pulumi.ComponentResource {
  // lambda image ecr repository
  ecr: awsx.ecr.Repository;
  // lamda image
  image: awsx.ecr.Image;
  // The lambda role
  role: aws.iam.Role;
  // The lambda
  lambda: aws.lambda.Function;
  // The security group
  lambdaSg: aws.ec2.SecurityGroup;
  // The lambda log group
  logGroup: aws.cloudwatch.LogGroup;

  tags: { [key: string]: string };
  constructor(
    name: string,
    args: PdfPreprocessLambdaArgs<T>,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:PdfPreprocessLambda', name, {}, opts);
    this.tags = args.tags;

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-image-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: PDF_PREPROCESS_LAMBDA_PATH,
        platform: {
          family: 'linux',
          architecture: 'amd64',
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;
    this.image = image.image;

    const bucketPolicy = new aws.iam.Policy(
      `${BASE_NAME}-bucket-policy`,
      {
        name: `${BASE_NAME}-bucket-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['s3:GetObject'],
              Resource: [
                args.docStorageBucketArn,
                pulumi.interpolate`${args.docStorageBucketArn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const ecrPolicy = new aws.iam.Policy(
      `${BASE_NAME}-ecr-policy`,
      {
        name: `${BASE_NAME}-ecr-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'ecr:GetDownloadUrlForLayer',
                'ecr:BatchGetImage',
                'ecr:BatchCheckLayerAvailability',
              ],
              Resource: '*',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const lambdaInvoke = new aws.iam.Policy(
      `${BASE_NAME}-lambda-invoke-policy`,
      {
        name: `${BASE_NAME}-lambda-invoke-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['lambda:InvokeFunction'],
              Resource: [args.jobUpdateHandlerLambdaArn],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        },
        managedPolicyArns: [
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          aws.iam.ManagedPolicies.AWSLambdaVPCAccessExecutionRole,
          aws.iam.ManagedPolicies.CloudWatchLogsFullAccess,
          bucketPolicy.arn,
          ecrPolicy.arn,
          lambdaInvoke.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    this.lambdaSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: args.vpc.vpcId,
        description: `${BASE_NAME} security group that is attached to the lambda`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${BASE_NAME}-all-in-${stack}`,
      {
        securityGroupId: this.lambdaSg.id,
        description: 'Allow all inbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-all-out-${stack}`,
      {
        securityGroupId: this.lambdaSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags: this.tags,
      },
      { parent: this }
    );

    this.logGroup = new aws.cloudwatch.LogGroup(
      `${BASE_NAME}-log-group-${stack}`,
      {
        name: `/aws/lambda/${BASE_NAME}-${stack}`,
        retentionInDays: 7,
        tags: this.tags,
      }
    );

    // Define the subscription filter
    new aws.cloudwatch.LogSubscriptionFilter(
      `${BASE_NAME}-log-subscription-filter`,
      {
        name: `${BASE_NAME}-${stack}`,
        logGroup: this.logGroup.name,
        destinationArn: DATADOG_KINESIS_FIREHOSE_STREAM_ARN,
        filterPattern: '{ $.* = "*" }',
        roleArn: CLOUDWATCH_KINESIS_STREAM_ROLE_ARN,
      }
    );

    this.lambda = new aws.lambda.Function(
      `${BASE_NAME}-${stack}`,
      {
        loggingConfig: {
          logFormat: 'Text',
          logGroup: this.logGroup.name,
        },
        name: `${BASE_NAME}-${stack}`,
        packageType: 'Image',
        imageUri: this.image.imageUri,
        architectures: ['x86_64'],
        role: this.role.arn,
        // MAX MEMORY SIZE ALLOWED
        // We give the max memory as this also gives the max cpu to the lambda as well.
        memorySize: 10240,
        // MAX 15 minute timeout
        timeout: 15 * 60,
        vpcConfig: {
          subnetIds: args.vpc.privateSubnetIds,
          securityGroupIds: [this.lambdaSg.id],
        },
        environment: { variables: { ...args.envVars } },
        tags: this.tags,
      },
      { parent: this }
    );
    this.setupLambdaAlarms();
  }

  setupLambdaAlarms() {
    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-throttle-alarm`,
      {
        name: `${BASE_NAME}-throttle-count-${stack}`,
        metricName: 'Throttles',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${BASE_NAME} lambda experiences throttling.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.cloudwatch.MetricAlarm(
      `${BASE_NAME}-error-alarm`,
      {
        name: `${BASE_NAME}-error-count-${stack}`,
        metricName: 'Errors',
        namespace: 'AWS/Lambda',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 1,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          FunctionName: this.lambda.name,
        },
        alarmDescription: `Alarm when ${BASE_NAME} lambda experiences errors.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: this.tags,
      },
      { parent: this }
    );
  }
}

/**
 * @description JDBC is dumb and doesn't accept db strings the same way EVERYONE
 * else does. This is another tick for why java stinks. We transform our nice simple
 * DATABASE_URL into the JDBC version.
 */
export function transformDatabaseUrl(
  databaseUrl: pulumi.Output<string> | string
): {
  DATABASE_URL: pulumi.Output<string> | string;
  DATABASE_USER: pulumi.Output<string> | string;
  DATABASE_PASSWORD: pulumi.Output<string> | string;
} {
  const url = pulumi.interpolate`${databaseUrl}`.apply(
    (url: string) => url.split('://')[1].split('@')[1]
  );

  const user = pulumi.interpolate`${databaseUrl}`.apply(
    (url: string) => url.split('://')[1].split('@')[0].split(':')[0]
  );

  const password = pulumi.interpolate`${databaseUrl}`.apply(
    (url: string) => url.split('://')[1].split('@')[0].split(':')[1]
  );
  return {
    DATABASE_URL: pulumi.interpolate`postgresql://${url}`,
    DATABASE_USER: pulumi.interpolate`${user}`,
    DATABASE_PASSWORD: pulumi.interpolate`${password}`,
  };
}
