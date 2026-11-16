// Routing and gateway endpoints of the coparse-api VPC. See AGENTS.md.
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import {
  get_coparse_api_vpc,
  SHARED_PRIVATE_ROUTE_TABLE_IDS,
  ZONAL_EGRESS_ZONES,
  type ZonalEgressZone,
} from '../../packages/vpc';

// Dev and prod stacks share this VPC; a dev stack would manage the same
// route tables twice.
if (stack !== 'prod') {
  throw new Error('vpc-network has only a prod stack: dev shares this VPC');
}

const BASE_NAME = pulumi.getProject();
const region = aws.config.requireRegion();
const config = new pulumi.Config();
const tags = { project: BASE_NAME, environment: stack, tech_lead: 'wolf' };
const vpc = get_coparse_api_vpc();

const [SHARED_A, SHARED_B] = SHARED_PRIVATE_ROUTE_TABLE_IDS;

// Each zone's public subnet, whose route table defaults to the internet
// gateway.
const PUBLIC_SUBNET_IDS: Record<ZonalEgressZone, string> = {
  'us-east-1b': 'subnet-0269c74c37f76ddab', // public-dataSubnet2
  'us-east-1c': 'subnet-042a406ca5480af5d', // public-subnet3
};

// The hand-made private subnets outside us-east-1a, and the shared route
// table each is associated with today. The CDK subnets (private-dataSubnet1
// and 2) keep their CDK associations.
const ZONAL_SUBNETS: {
  name: string;
  subnetId: string;
  zone: ZonalEgressZone;
  sharedRouteTableId: string;
}[] = [
  {
    name: 'private-subnet3',
    subnetId: 'subnet-03c3753c5342f434e',
    zone: 'us-east-1c',
    sharedRouteTableId: SHARED_A,
  },
  {
    name: 'private-subnet4',
    subnetId: 'subnet-0e2530cd19536fe10',
    zone: 'us-east-1b',
    sharedRouteTableId: SHARED_B,
  },
  {
    name: 'private-subnet5',
    subnetId: 'subnet-0fbceaf160d80bf77',
    zone: 'us-east-1b',
    sharedRouteTableId: SHARED_A,
  },
];

// Rollout switches; see AGENTS.md. While `adoptSubnetAssociations` is true,
// the existing associations are imported unchanged. `zonalEgressZones` lists
// the zones whose subnets route through their own zone's NAT.
const adoptSubnetAssociations =
  config.getBoolean('adoptSubnetAssociations') ?? false;
const zonalEgressZones =
  config.getObject<ZonalEgressZone[]>('zonalEgressZones') ?? [];
for (const zone of zonalEgressZones) {
  if (!ZONAL_EGRESS_ZONES.includes(zone)) {
    throw new Error(`zonalEgressZones: unknown zone ${zone}`);
  }
}
if (adoptSubnetAssociations && zonalEgressZones.length > 0) {
  throw new Error('Adopt the subnet associations before moving any zone');
}

// --- Gateway endpoints --------------------------------------------------------

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

// Every private route table needs both, or its S3 and DynamoDB traffic pays
// NAT processing again.
function attachEndpoints(key: string, routeTableId: pulumi.Input<string>) {
  new aws.ec2.VpcEndpointRouteTableAssociation(`${BASE_NAME}-s3-${key}`, {
    vpcEndpointId: s3Endpoint.id,
    routeTableId,
  });
  new aws.ec2.VpcEndpointRouteTableAssociation(
    `${BASE_NAME}-dynamodb-${key}`,
    { vpcEndpointId: DYNAMODB_ENDPOINT_ID, routeTableId }
  );
}

for (const routeTableId of SHARED_PRIVATE_ROUTE_TABLE_IDS) {
  attachEndpoints(routeTableId, routeTableId);
}

// --- One NAT per zone -----------------------------------------------------------

// Tasks outside us-east-1a otherwise cross zones to reach the CDK NAT, paying
// regional transfer both ways, and lose egress when us-east-1a does.
const zonal = ZONAL_EGRESS_ZONES.map((zone) => {
  const address = new aws.ec2.Eip(`${BASE_NAME}-nat-${zone}`, {
    domain: 'vpc',
    tags: { ...tags, Name: `${BASE_NAME}-nat-${zone}` },
  });
  const nat = new aws.ec2.NatGateway(`${BASE_NAME}-${zone}`, {
    subnetId: PUBLIC_SUBNET_IDS[zone],
    allocationId: address.id,
    tags: { ...tags, Name: `${BASE_NAME}-${zone}` },
  });
  const routeTable = new aws.ec2.RouteTable(`${BASE_NAME}-private-${zone}`, {
    vpcId: vpc.vpcId,
    tags: { ...tags, Name: `${BASE_NAME}-private-${zone}` },
  });
  new aws.ec2.Route(`${BASE_NAME}-egress-${zone}`, {
    routeTableId: routeTable.id,
    destinationCidrBlock: '0.0.0.0/0',
    natGatewayId: nat.id,
  });
  attachEndpoints(zone, routeTable.id);
  return { zone, address, routeTable };
});
const zonalRouteTableIds = Object.fromEntries(
  zonal.map(({ zone, routeTable }) => [zone, routeTable.id])
) as Record<ZonalEgressZone, pulumi.Output<string>>;

for (const subnet of ZONAL_SUBNETS) {
  // Changing routeTableId replaces the association in place
  // (ReplaceRouteTableAssociation): the subnet is never unassociated, but
  // its open connections through the old NAT drop.
  new aws.ec2.RouteTableAssociation(
    `${BASE_NAME}-${subnet.name}`,
    {
      subnetId: subnet.subnetId,
      routeTableId: zonalEgressZones.includes(subnet.zone)
        ? zonalRouteTableIds[subnet.zone]
        : subnet.sharedRouteTableId,
    },
    {
      import: adoptSubnetAssociations
        ? `${subnet.subnetId}/${subnet.sharedRouteTableId}`
        : undefined,
      // Deleting an association drops the subnet onto the main route table,
      // which has no default route.
      retainOnDelete: true,
    }
  );
}

export const s3EndpointId = s3Endpoint.id;
export const dynamodbEndpointId = DYNAMODB_ENDPOINT_ID;
// Keyed by PRIVATE_ROUTE_TABLE_KEYS (packages/vpc); computers-dev-gateway
// routes into every one of them.
export const privateRouteTableIds = {
  ...Object.fromEntries(SHARED_PRIVATE_ROUTE_TABLE_IDS.map((id) => [id, id])),
  ...zonalRouteTableIds,
};
export const natPublicIps = Object.fromEntries(
  zonal.map(({ zone, address }) => [zone, address.publicIp])
);
