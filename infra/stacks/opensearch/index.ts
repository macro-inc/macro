import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'opensearch',
};

const vpc = get_coparse_api_vpc();

// IMPORTANT: never export this variable. it contains sensitive information.
const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('db-password-key'),
  })
  .apply((secret) => secret.secretString);

const opensearchSecurityGroup = new aws.ec2.SecurityGroup(`opensearch-sg`, {
  name: `macro-opensearch-sg-${stack}`,
  vpcId: vpc.vpcId,
  description: `macro opensearch security group that is attached to the opensearch domain`,
  tags,
});

new aws.vpc.SecurityGroupIngressRule(`opensearch-vpc-in`, {
  securityGroupId: opensearchSecurityGroup.id,
  description: 'Allow vpc inbound',
  cidrIpv4: '10.0.0.0/16',
  ipProtocol: '-1',
  tags,
});

new aws.vpc.SecurityGroupEgressRule(`opensearch-all-out`, {
  securityGroupId: opensearchSecurityGroup.id,
  description: 'Allow all outbound',
  cidrIpv4: '0.0.0.0/0',
  ipProtocol: '-1',
  tags,
});

// Create CloudWatch Log Groups for OpenSearch logs
const indexSlowLogGroup = new aws.cloudwatch.LogGroup(
  `opensearch-index-slow-logs-${stack}`,
  {
    name: `/aws/opensearch/domains/macro-opensearch-${stack}/index-slow-logs`,
    retentionInDays: stack === 'prod' ? 30 : 7,
    tags,
  }
);

const searchSlowLogGroup = new aws.cloudwatch.LogGroup(
  `opensearch-search-slow-logs-${stack}`,
  {
    name: `/aws/opensearch/domains/macro-opensearch-${stack}/search-slow-logs`,
    retentionInDays: stack === 'prod' ? 30 : 7,
    tags,
  }
);

const applicationLogGroup = new aws.cloudwatch.LogGroup(
  `opensearch-application-logs-${stack}`,
  {
    name: `/aws/opensearch/domains/macro-opensearch-${stack}/application-logs`,
    retentionInDays: stack === 'prod' ? 7 : 3,
    tags,
  }
);

// Create CloudWatch Logs Resource Policy to allow OpenSearch to write logs
const opensearchLogsPolicy = new aws.cloudwatch.LogResourcePolicy(
  `opensearch-logs-policy-${stack}`,
  {
    policyName: `opensearch-logs-policy-${stack}`,
    policyDocument: pulumi
      .all([
        indexSlowLogGroup.arn,
        searchSlowLogGroup.arn,
        applicationLogGroup.arn,
      ])
      .apply(([indexArn, searchArn, appArn]) =>
        JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: {
                Service: 'es.amazonaws.com',
              },
              Action: ['logs:CreateLogStream', 'logs:PutLogEvents'],
              Resource: [`${indexArn}:*`, `${searchArn}:*`, `${appArn}:*`],
            },
          ],
        })
      ),
  }
);

// Create an OpenSearch domain
const opensearchDomain = new aws.opensearch.Domain(
  `macro-opensearch-${stack}`,
  {
    domainName: `macro-opensearch-${stack}`,
    domainEndpointOptions: {
      enforceHttps: true,
    },
    engineVersion: 'OpenSearch_3.5', // specify the desired OpenSearch version
    clusterConfig: {
      instanceType: stack === 'prod' ? 'r7g.large.search' : 'r7g.medium.search', // TODO: we may need to bump the instance type for prod.
      // the instance count needs to be multiples of 3 for multiAzWithStandbyEnabled and 2 for !multiAzWithStandbyEnabled
      instanceCount: stack === 'prod' ? 3 : 2, // TODO: we may want more than 3 instances for prod
      multiAzWithStandbyEnabled: stack === 'prod', // Only enable multi-az for prod
      // Enbale master nodes for prod
      dedicatedMasterCount: stack === 'prod' ? 3 : undefined,
      dedicatedMasterEnabled: stack === 'prod',
      dedicatedMasterType: stack === 'prod' ? 'r7g.large.search' : undefined,
      zoneAwarenessEnabled: stack === 'prod',

      zoneAwarenessConfig:
        stack === 'prod'
          ? {
              availabilityZoneCount: 3,
            }
          : undefined,
    },
    // per instance storage
    ebsOptions: {
      ebsEnabled: true,
      volumeSize: stack === 'prod' ? 256 : 50,
      volumeType: 'gp3',
    },
    nodeToNodeEncryption: {
      enabled: true,
    },
    encryptAtRest: {
      enabled: true,
    },
    advancedSecurityOptions: {
      enabled: true,
      internalUserDatabaseEnabled: true,
      masterUserOptions: {
        masterUserName: 'macrouser',
        masterUserPassword: password,
      },
    },
    advancedOptions: {
      // when set to false, bulk operations requires more specific index targeting for safety, preventing accidental operations across multiple indices.
      'rest.action.multi.allow_explicit_index': 'true',
    },
    // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/fgac.html#fgac-recommendations
    // We use the simple username/password policy as it allows for simplest connection to the opensearch domain
    accessPolicies: JSON.stringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Principal: {
            AWS: '*',
          },
          Action: 'es:*',
          Resource: `arn:aws:es:us-east-1:569036502058:domain/macro-opensearch-${stack}/*`,
        },
      ],
    }),
    // we will have public access for non-prod to make testing simpler
    // prod being behind the VPC will ensure only vpc traffic can route to the opensearch domain
    vpcOptions:
      stack === 'prod'
        ? {
            securityGroupIds: [opensearchSecurityGroup.id],
            subnetIds: vpc.privateSubnetIds,
          }
        : undefined,
    ipAddressType: stack === 'prod' ? 'ipv4' : 'dualstack', // vpc doesn't have ipv6 for prod
    logPublishingOptions: [
      {
        logType: 'INDEX_SLOW_LOGS',
        cloudwatchLogGroupArn: indexSlowLogGroup.arn,
        enabled: true,
      },
      {
        logType: 'SEARCH_SLOW_LOGS',
        cloudwatchLogGroupArn: searchSlowLogGroup.arn,
        enabled: true,
      },
      {
        logType: 'ES_APPLICATION_LOGS',
        cloudwatchLogGroupArn: applicationLogGroup.arn,
        enabled: true,
      },
    ],
    tags,
  },
  { dependsOn: [opensearchLogsPolicy] }
);

// export the domain endpoint
export const domainEndpoint = opensearchDomain.endpoint;
export const opensearchArn = opensearchDomain.arn;
