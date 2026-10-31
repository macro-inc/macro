import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import { parse } from 'smol-toml';

const stack = pulumi.getStack();
if (stack !== 'dev' && stack !== 'prod') {
  throw new Error('Only dev and prod stacks are supported');
}
const config = new pulumi.Config();
const vpcId = config.require('vpcId');
const publicSubnetIds = config.requireObject<string[]>('publicSubnetIds');
const privateSubnetIds = config.requireObject<string[]>('privateSubnetIds');
if (publicSubnetIds.length < 2 || privateSubnetIds.length < 2) {
  throw new Error('At least two public and two private subnets are required');
}
const host = config.require('publicHost');
const publicUrl = `https://${host}`;
const tags = { project: 'macro-connect', environment: stack };
const name = `macro-connect-${stack}`;
const zoneId = 'Z0766278GIHB3CVV9CIL';
const vpc = aws.ec2.getVpcOutput({ id: vpcId });

// Keep own-app credentials in encrypted stack config and include only live apps.
const registry = resolve(__dirname, '../registry/apps');
const liveOwnApps = readdirSync(registry).filter((id) => {
  const app = parse(readFileSync(join(registry, id, 'app.toml'), 'utf8'));
  return app.status === 'live' && app.client_registration === 'own_app';
});
type OwnAppCredentials = Record<
  string,
  { clientId: string; clientSecret: string }
>;
const ownAppCredentials =
  config.getSecretObject<OwnAppCredentials>('ownAppCredentials');
if (liveOwnApps.length > 0 && !ownAppCredentials) {
  throw new Error(
    'Live own-app entries require encrypted ownAppCredentials config',
  );
}
const ownAppSecrets = pulumi
  .all([
    ownAppCredentials ?? pulumi.output({} as OwnAppCredentials),
    pulumi.output(liveOwnApps),
  ])
  .apply(([credentials, ids]) => {
    const result: Record<string, string> = {};
    for (const id of ids) {
      const client = credentials[id];
      if (!client?.clientId || !client.clientSecret) {
        throw new Error(`Missing own-app credentials for ${id}`);
      }
      const prefix = id.toUpperCase();
      result[`${prefix}_CLIENT_ID`] = client.clientId;
      result[`${prefix}_CLIENT_SECRET`] = client.clientSecret;
    }
    return result;
  });

const repository = new aws.ecr.Repository(`${name}-repo`, {
  name,
  imageScanningConfiguration: { scanOnPush: true },
  tags,
});
const image = new awsx.ecr.Image(`${name}-image`, {
  repositoryUrl: repository.repositoryUrl,
  context: '../..',
  dockerfile: '../../connect/services/connect_api/Dockerfile',
  platform: 'linux/amd64',
});
const cluster = new aws.ecs.Cluster(`${name}-cluster`, { tags });
const logs = new aws.cloudwatch.LogGroup(`${name}-logs`, {
  name: `/ecs/${name}`,
  retentionInDays: stack === 'prod' ? 30 : 7,
  tags,
});

const assumeTask = JSON.stringify({
  Version: '2012-10-17',
  Statement: [
    {
      Effect: 'Allow',
      Principal: { Service: 'ecs-tasks.amazonaws.com' },
      Action: 'sts:AssumeRole',
    },
  ],
});
const taskRole = new aws.iam.Role(`${name}-task-role`, {
  assumeRolePolicy: assumeTask,
  tags,
});
const executionRole = new aws.iam.Role(`${name}-execution-role`, {
  assumeRolePolicy: assumeTask,
  tags,
});
new aws.iam.RolePolicyAttachment(`${name}-execution-base`, {
  role: executionRole.name,
  policyArn:
    'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
});

const account = aws.getCallerIdentityOutput();
const grantKey = new aws.kms.Key(
  `${name}-grants`,
  {
    description: 'Macro Connect grant envelope key',
    enableKeyRotation: true,
    deletionWindowInDays: 30,
    tags,
    policy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Sid: 'Administration',
          Effect: 'Allow',
          Principal: {
            AWS: pulumi.interpolate`arn:aws:iam::${account.accountId}:root`,
          },
          Action: [
            'kms:Create*',
            'kms:Describe*',
            'kms:Enable*',
            'kms:List*',
            'kms:Put*',
            'kms:Update*',
            'kms:Revoke*',
            'kms:Disable*',
            'kms:Get*',
            'kms:Delete*',
            'kms:TagResource',
            'kms:UntagResource',
            'kms:ScheduleKeyDeletion',
            'kms:CancelKeyDeletion',
          ],
          Resource: '*',
        },
        {
          Sid: 'TaskCryptography',
          Effect: 'Allow',
          Principal: { AWS: taskRole.arn },
          Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
          Resource: '*',
        },
      ],
    }),
  },
  { protect: stack === 'prod' },
);
new aws.iam.RolePolicy(`${name}-task-kms`, {
  role: taskRole.name,
  policy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: ['kms:Encrypt', 'kms:Decrypt', 'kms:GenerateDataKey'],
        Resource: grantKey.arn,
      },
    ],
  }),
});

const albSg = new aws.ec2.SecurityGroup(`${name}-alb-sg`, {
  vpcId: vpc.id,
  egress: [],
  tags,
});
const taskSg = new aws.ec2.SecurityGroup(`${name}-task-sg`, {
  vpcId: vpc.id,
  egress: [],
  tags,
});
const dbSg = new aws.ec2.SecurityGroup(`${name}-db-sg`, {
  vpcId: vpc.id,
  egress: [],
  tags,
});
for (const port of [80, 443]) {
  new aws.vpc.SecurityGroupIngressRule(`${name}-alb-${port}`, {
    securityGroupId: albSg.id,
    ipProtocol: 'tcp',
    fromPort: port,
    toPort: port,
    cidrIpv4: '0.0.0.0/0',
    tags,
  });
}
new aws.vpc.SecurityGroupEgressRule(`${name}-alb-to-task`, {
  securityGroupId: albSg.id,
  ipProtocol: 'tcp',
  fromPort: 8080,
  toPort: 8080,
  referencedSecurityGroupId: taskSg.id,
  tags,
});
new aws.vpc.SecurityGroupIngressRule(`${name}-task-from-alb`, {
  securityGroupId: taskSg.id,
  ipProtocol: 'tcp',
  fromPort: 8080,
  toPort: 8080,
  referencedSecurityGroupId: albSg.id,
  tags,
});
new aws.vpc.SecurityGroupEgressRule(`${name}-task-out`, {
  securityGroupId: taskSg.id,
  ipProtocol: '-1',
  cidrIpv4: '0.0.0.0/0',
  tags,
});
new aws.vpc.SecurityGroupIngressRule(`${name}-db-from-task`, {
  securityGroupId: dbSg.id,
  ipProtocol: 'tcp',
  fromPort: 5432,
  toPort: 5432,
  referencedSecurityGroupId: taskSg.id,
  tags,
});

const dbSubnets = new aws.rds.SubnetGroup(`${name}-db-subnets`, {
  subnetIds: privateSubnetIds,
  tags,
});
const database = new aws.rds.Instance(
  `${name}-db`,
  {
    identifier: `${name}-db`,
    engine: 'postgres',
    engineVersion: '17',
    instanceClass: stack === 'prod' ? 'db.t4g.small' : 'db.t4g.micro',
    allocatedStorage: 20,
    storageType: 'gp3',
    storageEncrypted: true,
    dbName: 'macro_connect',
    username: 'connect_api',
    manageMasterUserPassword: true,
    dbSubnetGroupName: dbSubnets.name,
    vpcSecurityGroupIds: [dbSg.id],
    publiclyAccessible: false,
    backupRetentionPeriod: stack === 'prod' ? 14 : 7,
    deletionProtection: stack === 'prod',
    skipFinalSnapshot: stack !== 'prod',
    finalSnapshotIdentifier: stack === 'prod' ? `${name}-db-final` : undefined,
    tags,
  },
  { protect: stack === 'prod' },
);
const dbSecretArn = database.masterUserSecrets.apply((secrets) => {
  if (secrets.length !== 1) throw new Error('RDS master secret is missing');
  return secrets[0].secretArn;
});
const dbSecret = aws.secretsmanager.getSecretVersionOutput({
  secretId: dbSecretArn,
});
const databaseUrl = pulumi.secret(
  pulumi
    .all([database.address, dbSecret.secretString])
    .apply(([address, secret]) => {
      const credentials = JSON.parse(secret) as { password: string };
      return `postgresql://connect_api:${encodeURIComponent(credentials.password)}@${address}:5432/macro_connect`;
    }),
);
const runtimeSecret = new aws.secretsmanager.Secret(`${name}-runtime`, {
  name: `${name}-runtime`,
  tags,
});
const runtimeSecretVersion = new aws.secretsmanager.SecretVersion(
  `${name}-runtime-version`,
  {
    secretId: runtimeSecret.id,
    secretString: pulumi.secret(
      pulumi
        .all([databaseUrl, grantKey.keyId, ownAppSecrets])
        .apply(([url, keyId, ownApps]) =>
          JSON.stringify({
            DATABASE_URL: url,
            CONNECT_KMS_KEY_ID: keyId,
            CONNECT_PUBLIC_URL: publicUrl,
            ...ownApps,
          }),
        ),
    ),
  },
);
new aws.iam.RolePolicy(`${name}-execution-secret`, {
  role: executionRole.name,
  policy: pulumi.jsonStringify({
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'secretsmanager:GetSecretValue',
        Resource: runtimeSecret.arn,
      },
    ],
  }),
});

const certificate = new aws.acm.Certificate(`${name}-cert`, {
  domainName: host,
  validationMethod: 'DNS',
  tags,
});
const dnsValidation = certificate.domainValidationOptions.apply((options) => {
  if (options.length !== 1)
    throw new Error('Expected one DNS validation record');
  const option = options[0];
  return new aws.route53.Record(`${name}-cert-dns`, {
    zoneId,
    name: option.resourceRecordName,
    type: option.resourceRecordType,
    records: [option.resourceRecordValue],
    ttl: 60,
  });
});
const certificateValidation = new aws.acm.CertificateValidation(
  `${name}-cert-valid`,
  {
    certificateArn: certificate.arn,
    validationRecordFqdns: dnsValidation.apply((record) => [record.fqdn]),
  },
);
const alb = new aws.lb.LoadBalancer(`${name}-alb`, {
  loadBalancerType: 'application',
  internal: false,
  subnets: publicSubnetIds,
  securityGroups: [albSg.id],
  enableDeletionProtection: stack === 'prod',
  tags,
});
const target = new aws.lb.TargetGroup(`${name}-target`, {
  port: 8080,
  protocol: 'HTTP',
  targetType: 'ip',
  vpcId: vpc.id,
  healthCheck: { path: '/health', protocol: 'HTTP', matcher: '200' },
  tags,
});
new aws.lb.Listener(`${name}-http`, {
  loadBalancerArn: alb.arn,
  port: 80,
  protocol: 'HTTP',
  defaultActions: [
    {
      type: 'redirect',
      redirect: {
        port: '443',
        protocol: 'HTTPS',
        statusCode: 'HTTP_301',
      },
    },
  ],
  tags,
});
const https = new aws.lb.Listener(`${name}-https`, {
  loadBalancerArn: alb.arn,
  port: 443,
  protocol: 'HTTPS',
  certificateArn: certificateValidation.certificateArn,
  sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
  defaultActions: [{ type: 'forward', targetGroupArn: target.arn }],
  tags,
});
new aws.route53.Record(`${name}-alias`, {
  zoneId,
  name: host,
  type: 'A',
  aliases: [
    { name: alb.dnsName, zoneId: alb.zoneId, evaluateTargetHealth: true },
  ],
});

const task = new aws.ecs.TaskDefinition(`${name}-task`, {
  family: name,
  cpu: '256',
  memory: '512',
  networkMode: 'awsvpc',
  requiresCompatibilities: ['FARGATE'],
  taskRoleArn: taskRole.arn,
  executionRoleArn: executionRole.arn,
  containerDefinitions: pulumi.jsonStringify([
    {
      name: 'connect_api',
      image: image.imageUri,
      essential: true,
      portMappings: [{ containerPort: 8080, protocol: 'tcp' }],
      secrets: [
        {
          name: 'APP_SECRETS_JSON',
          valueFrom: pulumi.interpolate`${runtimeSecret.arn}:::${runtimeSecretVersion.versionId}`,
        },
      ],
      logConfiguration: {
        logDriver: 'awslogs',
        options: {
          'awslogs-group': logs.name,
          'awslogs-region': aws.config.region ?? 'us-east-1',
          'awslogs-stream-prefix': 'connect_api',
        },
      },
    },
  ]),
  tags,
});
const service = new aws.ecs.Service(
  `${name}-service`,
  {
    cluster: cluster.arn,
    taskDefinition: task.arn,
    desiredCount: 1,
    launchType: 'FARGATE',
    deploymentCircuitBreaker: { enable: true, rollback: true },
    networkConfiguration: {
      subnets: privateSubnetIds,
      securityGroups: [taskSg.id],
      assignPublicIp: false,
    },
    loadBalancers: [
      {
        targetGroupArn: target.arn,
        containerName: 'connect_api',
        containerPort: 8080,
      },
    ],
    tags,
  },
  { dependsOn: [https, runtimeSecretVersion] },
);

export const connectUrl = publicUrl;
export const clusterArn = cluster.arn;
export const serviceArn = service.id;
