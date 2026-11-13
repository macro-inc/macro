// WireGuard gateway from the dev VPC to the dev computers host. See AGENTS.md.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

if (stack !== 'dev') {
  throw new Error('The computers WireGuard gateway is dev-only');
}

const BASE_NAME = pulumi.getProject();
const region = aws.config.requireRegion();
const config = new pulumi.Config();
const tags = { project: BASE_NAME, environment: stack, tech_lead: 'wolf' };
const vpc = get_coparse_api_vpc();

const WIREGUARD_PORT = 51820;
const INCUS_PORT = 8443;
const GATEWAY_ADDRESS = '10.99.0.1/24';
const HOST_TUNNEL_ADDRESS = '10.99.0.2/32';
// runtime-dev-1's internal address in the macro-computers GCP VPC.
const INCUS_ADDRESS = '10.200.0.2';

// runtime-dev-1's external address. It is an ephemeral GCE NAT IP, so it is
// config: promote it to a static address, then update this value.
const hostEndpointAddress = config.require('hostEndpointAddress');
const hostPublicKey = config.require('hostPublicKey');
const gatewayPrivateKey = config.requireSecret('gatewayPrivateKey');

// Public subnet in us-east-1c: the Elastic IP needs an internet gateway route.
const GATEWAY_SUBNET_ID = vpc.publicSubnetIds[0];
// The route tables of the private subnets the agent harness tasks run in.
// They are shared with prod; the /32 route only steers traffic for the host.
const PRIVATE_ROUTE_TABLE_IDS = [
  'rtb-00dfae8780d5d8d84',
  'rtb-027a26d11875ac278',
];

const harnessSecurityGroup = aws.ec2.getSecurityGroupOutput({
  name: `agent-harness-service-sg-${stack}`,
  vpcId: vpc.vpcId,
});

// --- Private key --------------------------------------------------------------

const privateKeyParameter = new aws.ssm.Parameter(`${BASE_NAME}-private-key`, {
  name: `/${BASE_NAME}/${stack}/wireguard-private-key`,
  type: aws.ssm.ParameterType.SecureString,
  value: gatewayPrivateKey,
  description: 'WireGuard private key of the computers gateway',
  tags,
});

// --- Instance role ------------------------------------------------------------

const role = new aws.iam.Role(`${BASE_NAME}-role`, {
  name: `${BASE_NAME}-role-${stack}`,
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: 'ec2.amazonaws.com',
  }),
  tags,
});
// Session Manager instead of SSH.
new aws.iam.RolePolicyAttachment(`${BASE_NAME}-ssm-core`, {
  role: role.name,
  policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
});
// The aws/ssm managed key decrypts for any principal allowed to read the
// parameter, so no KMS grant is needed.
new aws.iam.RolePolicy(`${BASE_NAME}-private-key-read`, {
  role: role.id,
  policy: {
    Version: '2012-10-17',
    Statement: [
      {
        Effect: 'Allow',
        Action: 'ssm:GetParameter',
        Resource: privateKeyParameter.arn,
      },
    ],
  },
});
const instanceProfile = new aws.iam.InstanceProfile(`${BASE_NAME}-profile`, {
  name: `${BASE_NAME}-profile-${stack}`,
  role: role.name,
  tags,
});

// --- Security group -----------------------------------------------------------

const securityGroup = new aws.ec2.SecurityGroup(`${BASE_NAME}-sg`, {
  name: `${BASE_NAME}-sg-${stack}`,
  vpcId: vpc.vpcId,
  description: 'Computers WireGuard gateway: Incus API from the dev harness',
  tags,
});
// Forwarded packets keep the harness task as their source, so this rule is
// what admits them to the gateway's interface.
new aws.vpc.SecurityGroupIngressRule(`${BASE_NAME}-in-harness`, {
  securityGroupId: securityGroup.id,
  description: 'Incus API from the dev agent harness',
  referencedSecurityGroupId: harnessSecurityGroup.id,
  ipProtocol: 'tcp',
  fromPort: INCUS_PORT,
  toPort: INCUS_PORT,
  tags,
});
new aws.vpc.SecurityGroupEgressRule(`${BASE_NAME}-out-wireguard`, {
  securityGroupId: securityGroup.id,
  description: 'WireGuard to runtime-dev-1',
  cidrIpv4: `${hostEndpointAddress}/32`,
  ipProtocol: 'udp',
  fromPort: WIREGUARD_PORT,
  toPort: WIREGUARD_PORT,
  tags,
});
new aws.vpc.SecurityGroupEgressRule(`${BASE_NAME}-out-https`, {
  securityGroupId: securityGroup.id,
  description: 'HTTPS to SSM and the package repositories',
  cidrIpv4: '0.0.0.0/0',
  ipProtocol: 'tcp',
  fromPort: 443,
  toPort: 443,
  tags,
});

// --- Instance -----------------------------------------------------------------

const ami = aws.ec2.getAmiOutput({
  mostRecent: true,
  owners: ['amazon'],
  filters: [
    { name: 'name', values: ['al2023-ami-2023.*-kernel-*-arm64'] },
    { name: 'architecture', values: ['arm64'] },
    { name: 'virtualization-type', values: ['hvm'] },
  ],
});

const userData = privateKeyParameter.name.apply((parameterName) =>
  fs
    .readFileSync(path.join(__dirname, 'user-data.sh'), 'utf-8')
    .replaceAll('__REGION__', region)
    .replaceAll('__PRIVATE_KEY_PARAMETER__', parameterName)
    .replaceAll('__GATEWAY_ADDRESS__', GATEWAY_ADDRESS)
    .replaceAll('__PEER_PUBLIC_KEY__', hostPublicKey)
    .replaceAll('__PEER_ENDPOINT__', `${hostEndpointAddress}:${WIREGUARD_PORT}`)
    .replaceAll(
      '__PEER_ALLOWED_IPS__',
      `${HOST_TUNNEL_ADDRESS}, ${INCUS_ADDRESS}/32`
    )
    .replaceAll('__INCUS_ADDRESS__', INCUS_ADDRESS)
    .replaceAll('__INCUS_PORT__', String(INCUS_PORT))
);

// The interface, and its Elastic IP, exist before the instance boots, so
// first-boot setup has internet access and the routes survive a replacement.
const networkInterface = new aws.ec2.NetworkInterface(`${BASE_NAME}-eni`, {
  subnetId: GATEWAY_SUBNET_ID,
  securityGroups: [securityGroup.id],
  // It routes packets that are not addressed to it.
  sourceDestCheck: false,
  description: 'Computers WireGuard gateway',
  tags: { ...tags, Name: `${BASE_NAME}-${stack}` },
});
const elasticIp = new aws.ec2.Eip(`${BASE_NAME}-eip`, {
  domain: 'vpc',
  networkInterface: networkInterface.id,
  tags: { ...tags, Name: `${BASE_NAME}-${stack}` },
});

const instance = new aws.ec2.Instance(
  `${BASE_NAME}-instance`,
  {
    ami: ami.id,
    instanceType: 't4g.nano',
    primaryNetworkInterface: { networkInterfaceId: networkInterface.id },
    iamInstanceProfile: instanceProfile.name,
    userData,
    userDataReplaceOnChange: true,
    metadataOptions: { httpTokens: 'required', httpEndpoint: 'enabled' },
    rootBlockDevice: { volumeType: 'gp3', volumeSize: 8, encrypted: true },
    tags: { ...tags, Name: `${BASE_NAME}-${stack}` },
  },
  // A newer AMI should not replace a running gateway on every preview.
  { ignoreChanges: ['ami'], dependsOn: [elasticIp] }
);

// --- Routes -------------------------------------------------------------------

for (const routeTableId of PRIVATE_ROUTE_TABLE_IDS) {
  new aws.ec2.Route(`${BASE_NAME}-incus-${routeTableId}`, {
    routeTableId,
    destinationCidrBlock: `${INCUS_ADDRESS}/32`,
    networkInterfaceId: networkInterface.id,
  });
}

export const gatewayPublicIp = elasticIp.publicIp;
export const gatewayInstanceId = instance.id;
export const gatewaySecurityGroupId = securityGroup.id;
export const harnessSecurityGroupId = harnessSecurityGroup.id;
export const privateKeyParameterName = privateKeyParameter.name;
