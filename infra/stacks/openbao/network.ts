import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

/**
 * The zones the vault runs in, by zone ID: zone names differ between AWS
 * accounts, and PrivateLink needs the vault's NLB in every zone where DSS's
 * endpoint lives. `mainAccountZone` is the same zone's name in the main
 * account, where the shared VPC's subnets are chosen.
 */
export const ZONES = [
  { zoneId: 'use1-az6', mainAccountZone: 'us-east-1a' },
  { zoneId: 'use1-az1', mainAccountZone: 'us-east-1b' },
] as const;

/**
 * The AWS APIs the task calls, each as a private-DNS interface endpoint, so
 * the standard hostnames resolve inside the VPC: `ecr.api` and `ecr.dkr` for
 * the image pull (layers come from S3 through the gateway endpoint), `logs`
 * for the awslogs driver, `kms` for the seal, and `ssmmessages` for ECS Exec
 * (the operator tunnel). No STS: Fargate hands the task role's credentials to
 * the container directly.
 */
const INTERFACE_SERVICES = [
  'ecr.api',
  'ecr.dkr',
  'logs',
  'kms',
  'ssmmessages',
] as const;
// Endpoints that could carry data to another account's resources (a key, a log
// group) admit only this account's. ECR keeps the default: the token call
// names no resource, and pulls only reach repositories the role may read.
const ACCOUNT_SCOPED_SERVICES: ReadonlySet<string> = new Set(['logs', 'kms']);

/**
 * The vault's VPC in the OpenBao account: private subnets only. The account's
 * SCPs deny internet and NAT gateways, and none is created, so the only ways
 * out are the AWS endpoints below and EFS. DSS reaches the vault through
 * PrivateLink (see `account.ts`).
 */
export function createNetwork(args: {
  name: string;
  region: string;
  accountId: pulumi.Input<string>;
  tags: Record<string, string>;
  provider: aws.Provider;
}) {
  const { name, region, accountId, tags, provider } = args;
  const options = { provider };
  const vpc = new aws.ec2.Vpc(
    name,
    {
      cidrBlock: '10.89.0.0/16',
      enableDnsSupport: true,
      enableDnsHostnames: true,
      tags: { ...tags, Name: name },
    },
    options
  );
  const routeTable = new aws.ec2.RouteTable(
    `${name}-private`,
    { vpcId: vpc.id, tags: { ...tags, Name: `${name}-private` } },
    options
  );
  const subnets = ZONES.map(
    ({ zoneId }, index) =>
      new aws.ec2.Subnet(
        `${name}-private-${zoneId}`,
        {
          vpcId: vpc.id,
          availabilityZoneId: zoneId,
          cidrBlock: `10.89.${index}.0/24`,
          mapPublicIpOnLaunch: false,
          tags: { ...tags, Name: `${name}-private-${zoneId}` },
        },
        options
      )
  );
  const associations = subnets.map(
    (subnet, index) =>
      new aws.ec2.RouteTableAssociation(
        `${name}-private-${index}`,
        { subnetId: subnet.id, routeTableId: routeTable.id },
        options
      )
  );

  const endpointSecurityGroup = new aws.ec2.SecurityGroup(
    `${name}-endpoints-sg`,
    {
      name: `${name}-endpoints-sg`,
      vpcId: vpc.id,
      description: 'AWS interface endpoints: HTTPS from the OpenBao task',
      tags,
    },
    options
  );
  const interfaceEndpoints = INTERFACE_SERVICES.map(
    (service) =>
      new aws.ec2.VpcEndpoint(
        `${name}-${service.replace('.', '-')}`,
        {
          vpcId: vpc.id,
          serviceName: `com.amazonaws.${region}.${service}`,
          vpcEndpointType: 'Interface',
          privateDnsEnabled: true,
          subnetIds: subnets.map((subnet) => subnet.id),
          securityGroupIds: [endpointSecurityGroup.id],
          policy: ACCOUNT_SCOPED_SERVICES.has(service)
            ? pulumi.jsonStringify({
                Version: '2012-10-17',
                Statement: [
                  {
                    Effect: 'Allow',
                    Principal: '*',
                    Action: '*',
                    Resource: '*',
                    Condition: {
                      StringEquals: { 'aws:ResourceAccount': accountId },
                    },
                  },
                ],
              })
            : undefined,
          tags: { ...tags, Name: `${name}-${service}` },
        },
        options
      )
  );
  const s3 = new aws.ec2.VpcEndpoint(
    `${name}-s3`,
    {
      vpcId: vpc.id,
      serviceName: `com.amazonaws.${region}.s3`,
      vpcEndpointType: 'Gateway',
      routeTableIds: [routeTable.id],
      // Only ECR's image-layer bucket, read-only: the task has no other use for
      // S3, and an open policy would let it write to any bucket.
      policy: JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: '*',
            Action: 's3:GetObject',
            Resource: `arn:aws:s3:::prod-${region}-starport-layer-bucket/*`,
          },
        ],
      }),
      tags: { ...tags, Name: `${name}-s3` },
    },
    options
  );
  // ECR keeps image layers in S3; the task's egress to S3 is this prefix list.
  const s3PrefixList = aws.ec2.getPrefixListOutput(
    { name: `com.amazonaws.${region}.s3` },
    options
  );

  return {
    vpcId: vpc.id,
    subnetIds: subnets.map((subnet) => subnet.id),
    endpointSecurityGroupId: endpointSecurityGroup.id,
    s3PrefixListId: s3PrefixList.id,
    ready: [...associations, ...interfaceEndpoints, s3],
  };
}
