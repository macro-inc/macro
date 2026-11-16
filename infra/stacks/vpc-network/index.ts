// Routing and gateway endpoints of the coparse-api VPC. See AGENTS.md.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

// Dev and prod stacks share this VPC; a dev stack would manage the same
// route tables twice.
if (stack !== 'prod') {
  throw new Error('vpc-network has only a prod stack: dev shares this VPC');
}

const BASE_NAME = pulumi.getProject();
const region = aws.config.requireRegion();
const tags = { project: BASE_NAME, environment: stack, tech_lead: 'wolf' };
const vpc = get_coparse_api_vpc();

// The route tables of every private subnet. Both belong to the legacy CDK
// stack (CoparseApiOrganizationVPCStack) and default-route to its one NAT.
const PRIVATE_ROUTE_TABLE_IDS = [
  'rtb-00dfae8780d5d8d84',
  'rtb-027a26d11875ac278',
];

// Hand-made in 2024 and attached only to the main route table, which no
// subnet uses, so DynamoDB traffic went through the NAT.
const DYNAMODB_ENDPOINT_ID = 'vpce-0897d4d90eb4914f6';

// S3 and DynamoDB over gateway endpoints are free; through the NAT they pay
// its per-GB processing.
const s3Endpoint = new aws.ec2.VpcEndpoint(`${BASE_NAME}-s3`, {
  vpcId: vpc.vpcId,
  serviceName: `com.amazonaws.${region}.s3`,
  vpcEndpointType: 'Gateway',
  tags: { ...tags, Name: `${BASE_NAME}-s3` },
});

for (const routeTableId of PRIVATE_ROUTE_TABLE_IDS) {
  new aws.ec2.VpcEndpointRouteTableAssociation(
    `${BASE_NAME}-s3-${routeTableId}`,
    { vpcEndpointId: s3Endpoint.id, routeTableId }
  );
  new aws.ec2.VpcEndpointRouteTableAssociation(
    `${BASE_NAME}-dynamodb-${routeTableId}`,
    { vpcEndpointId: DYNAMODB_ENDPOINT_ID, routeTableId }
  );
}

export const s3EndpointId = s3Endpoint.id;
export const dynamodbEndpointId = DYNAMODB_ENDPOINT_ID;
export const privateRouteTableIds = PRIVATE_ROUTE_TABLE_IDS;
