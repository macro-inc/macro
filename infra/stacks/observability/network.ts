import * as aws from '@pulumi/aws';

// Independent of prod's VPC, NAT, and regional endpoints. One private host
// subnet and one NAT are intentional for the single-instance pilot.
export function createNetwork(region: string, tags: Record<string, string>) {
  const vpc = new aws.ec2.Vpc('observability', {
    cidrBlock: '10.88.0.0/16',
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags,
  });
  const internet = new aws.ec2.InternetGateway('observability', {
    vpcId: vpc.id,
    tags,
  });
  const publicRoutes = new aws.ec2.RouteTable('observability-public', {
    vpcId: vpc.id,
    tags,
  });
  const internetRoute = new aws.ec2.Route('observability-internet', {
    routeTableId: publicRoutes.id,
    destinationCidrBlock: '0.0.0.0/0',
    gatewayId: internet.id,
  });
  const publicSubnets = ['a', 'b'].map(
    (zone, index) =>
      new aws.ec2.Subnet(`observability-public-${zone}`, {
        vpcId: vpc.id,
        availabilityZone: `${region}${zone}`,
        cidrBlock: `10.88.${index}.0/24`,
        mapPublicIpOnLaunch: false,
        tags,
      })
  );
  const publicAssociations = publicSubnets.map(
    (subnet, index) =>
      new aws.ec2.RouteTableAssociation(`observability-public-${index}`, {
        subnetId: subnet.id,
        routeTableId: publicRoutes.id,
      })
  );
  const natAddress = new aws.ec2.Eip('observability-nat', {
    domain: 'vpc',
    tags,
  });
  const nat = new aws.ec2.NatGateway(
    'observability',
    {
      subnetId: publicSubnets[0].id,
      allocationId: natAddress.id,
      tags,
    },
    { dependsOn: [internetRoute, ...publicAssociations] }
  );
  const privateSubnet = new aws.ec2.Subnet('observability-private', {
    vpcId: vpc.id,
    availabilityZone: `${region}a`,
    cidrBlock: '10.88.10.0/24',
    mapPublicIpOnLaunch: false,
    tags,
  });
  const privateRoutes = new aws.ec2.RouteTable('observability-private', {
    vpcId: vpc.id,
    tags,
  });
  const natRoute = new aws.ec2.Route('observability-egress', {
    routeTableId: privateRoutes.id,
    destinationCidrBlock: '0.0.0.0/0',
    natGatewayId: nat.id,
  });
  const privateAssociation = new aws.ec2.RouteTableAssociation(
    'observability-private',
    {
      subnetId: privateSubnet.id,
      routeTableId: privateRoutes.id,
    }
  );
  const s3 = new aws.ec2.VpcEndpoint('observability-s3', {
    vpcId: vpc.id,
    serviceName: `com.amazonaws.${region}.s3`,
    vpcEndpointType: 'Gateway',
    routeTableIds: [privateRoutes.id],
    tags,
  });
  return {
    vpcId: vpc.id,
    privateSubnet,
    publicSubnetIds: publicSubnets.map((subnet) => subnet.id),
    publicReady: [internetRoute, ...publicAssociations],
    privateReady: [natRoute, privateAssociation, s3],
  };
}
