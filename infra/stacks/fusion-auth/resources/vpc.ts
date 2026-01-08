const LEGACY_PRIVATE_SUBNETS = [
  {
    name: 'private-subnet3',
    value: 'subnet-03c3753c5342f434e',
    az: 'us-east-1c',
  },
  {
    name: 'private-subnet4',
    value: 'subnet-0e2530cd19536fe10',
    az: 'us-east-1b',
  },
  {
    name: 'private-subnet6',
    value: 'subnet-0306dce66c915072a',
    az: 'us-east-1a',
  },
];

export function get_coparse_api_vpc() {
  return {
    vpcId: 'vpc-0c7510191d4fc9263',
    privateSubnetIds: LEGACY_PRIVATE_SUBNETS.map((n) => n.value),
    publicSubnetIds: [
      'subnet-0911c0ebea104055d', // CoparseApiOrganizationVPCStack/coparse-api-vpc/public-dataSubnet1
      'subnet-0269c74c37f76ddab', // CoparseApiOrganizationVPCStack/coparse-api-vpc/public-dataSubnet2
      'subnet-042a406ca5480af5d', // public-subnet3
    ],
  };
}

export function coparse_api_vpc_filtered_subnets(az: string[]) {
  const result = LEGACY_PRIVATE_SUBNETS.filter((n) => az.includes(n.az));
  if (result.length === 0) {
    throw new Error('no valid subnets after filter');
  }
  return result.map((n) => n.value);
}
