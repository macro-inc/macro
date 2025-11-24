import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
  serviceLoadBalancer,
} from '@resources';
import { ALLOWED_ORIGINS } from '@resources/resources/cors';
import { EcrImage } from '@service';
import { BASE_DOMAIN, MACRO_SUBDOMAIN_CERT } from '@shared';
import { StaticFileCloudFront } from './distribution';

const stack = pulumi.getStack();
export const SERVICE_NAME = 'static-file-service';
export const SERVICE_DOMAIN_NAME = `static-file-service${stack === 'prod' ? '' : `-${stack}`}`;
export const SERVICE_URL = `https://${SERVICE_DOMAIN_NAME}.${BASE_DOMAIN}`;
export const STATIC_FILE_BUCKET = `static-file-storage-${stack}`;

const BASE_PATH = '../../../rust/cloud-storage';

const NOT_FOUND_FILE = './error_404.html';
const NOT_FOUND_KEY = 'error_404.html';

export type StaticFileServiceArgs = {
  cloudStorageClusterName: pulumi.Output<string> | string;
  ecsClusterArn: pulumi.Output<string> | string;
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  platform: { family: string; architecture: 'amd64' | 'arm64' };
  serviceContainerPort: number;
  isPrivate?: boolean;
  containerEnvVars?: { name: string; value: pulumi.Output<string> | string }[];
  healthCheckPath: string;
  tags: { [key: string]: string };
  /// available as an env var under DYNAMODB_TABLE_NAME
  dynamoDbTableName: string;
  secretKeyArns: (pulumi.Output<string> | string)[];
};

// todo logging / monitoring
export class StaticFileService extends pulumi.ComponentResource {
  public ecr: awsx.ecr.Repository;
  public serviceAlbSg: aws.ec2.SecurityGroup;
  public serviceSg: aws.ec2.SecurityGroup;
  public targetGroup: aws.lb.TargetGroup;
  public lb: aws.lb.LoadBalancer;
  public listener: aws.lb.Listener;
  public service: awsx.ecs.FargateService;
  public domain: string;
  public cloudStorageClusterName: pulumi.Output<string> | string;
  public tags: { [key: string]: string };
  public role: aws.iam.Role;

  constructor(
    name: string,
    args: StaticFileServiceArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:StaticFileService', name, {}, opts);

    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });
    this.tags = args.tags;
    this.cloudStorageClusterName = args.cloudStorageClusterName;

    // we do a bit of security
    const { serviceAlbSg, serviceSg } = this.initializeSecurityGroups({
      serviceContainerPort: args.serviceContainerPort,
      vpcId: args.vpc.vpcId,
    });

    this.serviceSg = serviceSg;
    this.serviceAlbSg = serviceAlbSg;

    // lb
    const { targetGroup, lb, listener } = serviceLoadBalancer(this, {
      serviceName: SERVICE_NAME, // service name
      serviceContainerPort: args.serviceContainerPort,
      healthCheckPath: args.healthCheckPath,
      vpc: args.vpc,
      albSecurityGroupId: this.serviceAlbSg.id,
      isPrivate: args.isPrivate,
      tags: args.tags,
      idleTimeout: 3600,
    });

    this.targetGroup = targetGroup;
    this.lb = lb;
    this.listener = listener;
    // this guy will host the axum api
    const image = new EcrImage(
      `${SERVICE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${SERVICE_NAME}-ecr-${stack}`,
        repositoryName: `${SERVICE_NAME}-${stack}`,
        imageId: `${SERVICE_NAME}-image-${stack}`,
        imagePath: BASE_PATH,
        dockerfile: 'Dockerfile',
        platform: args.platform,
        buildArgs: {
          SERVICE_NAME: 'static_file_service',
        },
        tags: this.tags,
      },
      { parent: this }
    );
    this.ecr = image.ecr;

    const staticFilesBucket = new aws.s3.Bucket(STATIC_FILE_BUCKET, {
      bucket: STATIC_FILE_BUCKET,
      forceDestroy: stack !== 'prod',

      corsRules: [
        {
          allowedHeaders: ['*'],
          allowedMethods: ['GET', 'PUT', 'POST', 'DELETE', 'HEAD'],
          allowedOrigins: ALLOWED_ORIGINS,
          exposeHeaders: ['ETag'],
          maxAgeSeconds: 3000,
        },
      ],
      tags: this.tags,
    });

    const notFound = new aws.s3.BucketObject(
      'object',
      {
        bucket: staticFilesBucket,
        key: NOT_FOUND_KEY,
        source: new pulumi.asset.FileAsset(NOT_FOUND_FILE),
        contentType: 'text/html',
        tags: this.tags,
      },
      { dependsOn: staticFilesBucket }
    );

    const distribution = new StaticFileCloudFront(
      `static-files-${stack}`,
      {
        bucket: staticFilesBucket,
        api: lb,
        stackName: stack,
        customDomain: {
          aliases: [`${SERVICE_DOMAIN_NAME}.macro.com`],
          certificateArn: MACRO_SUBDOMAIN_CERT,
        },
        notFoundPage: notFound,
        tags: this.tags,
      },
      { dependsOn: notFound }
    );

    new aws.route53.Record(`${SERVICE_NAME}-cdn-domain-record`, {
      name: SERVICE_DOMAIN_NAME,
      type: 'A',
      zoneId: zone.zoneId,
      aliases: [
        {
          evaluateTargetHealth: false,
          name: distribution.distribution.domainName,
          zoneId: distribution.distribution.hostedZoneId,
        },
      ],
    });

    const metadataTable = new aws.dynamodb.Table(
      args.dynamoDbTableName,
      {
        name: args.dynamoDbTableName,
        billingMode: 'PAY_PER_REQUEST',
        hashKey: 'file_id', // Only file_id as primary key
        tags: this.tags,
        attributes: [
          {
            name: 'file_id',
            type: 'S',
          },
          {
            name: 'owner_id',
            type: 'S',
          },
        ],
        globalSecondaryIndexes: [
          {
            name: 'owner-index',
            hashKey: 'owner_id',
            projectionType: 'ALL',
          },
        ],
      },
      { parent: this }
    );

    const dynamoDbPolicy = new aws.iam.Policy(
      `${SERVICE_NAME}-dynamodb-policy`,
      {
        name: `${SERVICE_NAME}-dynamodb-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'dynamodb:PutItem',
                'dynamodb:GetItem',
                'dynamodb:UpdateItem',
                'dynamodb:DeleteItem',
                'dynamodb:Query',
                'dynamodb:Scan',
              ],
              Resource: [
                metadataTable.arn,
                pulumi.interpolate`${metadataTable.arn}/index/*`, // For GSI access
              ],
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    const ecrPolicy = new aws.iam.Policy(`${SERVICE_NAME}-ecr-policy`, {
      name: `${SERVICE_NAME}-ecr-policy-${stack}`,
      policy: {
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: [
              'ecr:GetAuthorizationToken',
              'ecr:BatchCheckLayerAvailability',
              'ecr:GetDownloadUrlForLayer',
              'ecr:GetRepositoryPolicy',
              'ecr:DescribeRepositories',
              'ecr:ListImages',
              'ecr:DescribeImages',
              'ecr:BatchGetImage',
              'ecr:InitiateLayerUpload',
              'ecr:UploadLayerPart',
              'ecr:CompleteLayerUpload',
              'ecr:PutImage',
            ],
            Resource: '*',
          },
        ],
      },
      tags: this.tags,
    });
    /*
      Permissive access policy
    */
    const staticFileBucketPolicy = new aws.iam.Policy(
      `${SERVICE_NAME}-static-file-bucket-storage-policy`,
      {
        name: `${SERVICE_NAME}-static-file-bucket-storage-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                's3:ListBucket',
                's3:GetObject',
                's3:PutObject',
                's3:DeleteObject',
              ],
              Resource: [
                staticFilesBucket.arn,
                pulumi.interpolate`${staticFilesBucket.arn}/*`,
              ],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    // i freaking love secrets
    const secretsManagerPolicy = new aws.iam.Policy(
      `${SERVICE_NAME}-secrets-manager-policy`,
      {
        name: `${SERVICE_NAME}-secrets-manager-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              Resource: [...args.secretKeyArns],
              Effect: 'Allow',
            },
          ],
        },
        tags: this.tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${SERVICE_NAME}-role`,
      {
        name: `${SERVICE_NAME}-role-${stack}`,
        assumeRolePolicy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Principal: {
                Service: 'ecs-tasks.amazonaws.com',
              },
              Effect: 'Allow',
              Sid: '',
            },
          ],
        },
        managedPolicyArns: [
          secretsManagerPolicy.arn,
          staticFileBucketPolicy.arn,
          ecrPolicy.arn,
          dynamoDbPolicy.arn,
        ],
        tags: this.tags,
      },
      { parent: this }
    );

    // https://www.pulumi.com/registry/packages/aws/api-docs/s3/bucketnotification/
    const queueName = `static-file-s3-event-notification-queue-${stack}`;
    const queue = aws.iam.getPolicyDocumentOutput({
      statements: [
        {
          effect: 'Allow',
          principals: [
            {
              type: '*',
              identifiers: ['*'],
            },
          ],
          actions: ['sqs:SendMessage'],
          resources: [`arn:aws:sqs:*:*:${queueName}`],
          conditions: [
            {
              test: 'ArnEquals',
              variable: 'aws:SourceArn',
              values: [staticFilesBucket.arn],
            },
          ],
        },
      ],
    });
    const queueQueue = new aws.sqs.Queue('queue', {
      name: queueName,
      policy: queue.apply((queue) => queue.json),
      receiveWaitTimeSeconds: 20,
      tags: this.tags,
    });

    new aws.s3.BucketNotification('bucket_notification', {
      bucket: staticFilesBucket.id,
      queues: [
        {
          queueArn: queueQueue.arn,
          events: ['s3:ObjectCreated:*'],
        },
      ],
    });

    const sqsPolicy = new aws.iam.RolePolicy('fargateTaskSQSPolicy', {
      role: this.role.id,
      policy: queueQueue.arn.apply((queueArn) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: [
                'sqs:ReceiveMessage',
                'sqs:DeleteMessage',
                'sqs:GetQueueAttributes',
                'sqs:ChangeMessageVisibility',
              ],
              Resource: queueArn,
            },
          ],
        })
      ),
    });
    const STORAGE_LOCATION = `https://${SERVICE_DOMAIN_NAME}.macro.com`;
    // service
    const service = new awsx.ecs.FargateService(
      `${SERVICE_NAME}`,
      {
        cluster: args.ecsClusterArn,
        networkConfiguration: {
          subnets: args.vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
        },
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          containers: {
            log_router: fargateLogRouterSidecarContainer,
            datadog_agent: datadogAgentContainer,
            service: {
              name: SERVICE_NAME,
              image: image.image.imageUri,
              cpu: 256,
              memory: 512,
              environment: [
                { name: `DYNAMODB_TABLE_NAME`, value: args.dynamoDbTableName },
                { name: `S3_BUCKET_URL`, value: STORAGE_LOCATION },
                { name: 'S3_EVENT_QUEUE_URL', value: queueQueue.url },
                ...(args.containerEnvVars ?? []),
              ],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: `static-file-service-${stack}`,
                  dd_source: 'fargate',
                  dd_tags: `project:cloudstorage, env:${stack}`,
                  provider: 'ecs',
                },
              },
              portMappings: [
                {
                  appProtocol: 'http',
                  name: `${SERVICE_NAME}-tcp-${stack}`,
                  hostPort: args.serviceContainerPort,
                  containerPort: args.serviceContainerPort,
                  targetGroup: targetGroup,
                },
              ],
            },
          },
          runtimePlatform: {
            operatingSystemFamily: `${args.platform.family.toUpperCase()}`,
            cpuArchitecture: `${
              args.platform.architecture === 'amd64'
                ? 'X86_64'
                : args.platform.architecture.toUpperCase()
            }`,
          },
        },
        desiredCount: 1,
        tags: this.tags,
      },
      { parent: this, dependsOn: [sqsPolicy, queueQueue] }
    );

    this.service = service;
    this.domain = `https://${SERVICE_DOMAIN_NAME}`;
  }

  initializeSecurityGroups({
    vpcId,
    serviceContainerPort,
  }: {
    vpcId: pulumi.Output<string> | string;
    serviceContainerPort: number;
  }) {
    const serviceAlbSg = new aws.ec2.SecurityGroup(
      `${SERVICE_NAME}-alb-sg-${stack}`,
      {
        name: `${SERVICE_NAME}-alb-sg-${stack}`,
        description: `${SERVICE_NAME} application load balancer security group`,
        vpcId,
        tags: this.tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${SERVICE_NAME}-sg-${stack}`,
      {
        name: `${SERVICE_NAME}-sg-${stack}`,
        vpcId,
        description: `${SERVICE_NAME} security group that is attached directly to the service`,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${SERVICE_NAME}-alb-in`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow inbound traffic from the services ALB',
        referencedSecurityGroupId: serviceAlbSg.id,
        fromPort: serviceContainerPort,
        toPort: serviceContainerPort,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${SERVICE_NAME}-all-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags: this.tags,
      },
      { parent: this }
    );

    // ALB SG rules
    new aws.vpc.SecurityGroupIngressRule(
      `${SERVICE_NAME}-http`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTP traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 80,
        ipProtocol: 'tcp',
        toPort: 80,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${SERVICE_NAME}-https`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTPS traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 443,
        ipProtocol: 'tcp',
        toPort: 443,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${SERVICE_NAME}-out-service`,
      {
        description: 'Allow traffic to the service security group',
        securityGroupId: serviceAlbSg.id,
        referencedSecurityGroupId: serviceSg.id,
        fromPort: serviceContainerPort,
        ipProtocol: 'tcp',
        toPort: serviceContainerPort,
        tags: this.tags,
      },
      { parent: this }
    );

    return { serviceAlbSg, serviceSg };
  }
}
