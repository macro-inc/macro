# vpc-network stack

## What it is

Routing and gateway endpoints of `vpc-0c7510191d4fc9263` (coparse-api-vpc),
the one VPC every dev and prod service runs in. The VPC, subnets, internet
gateway, the us-east-1a NAT and the two shared private route tables were made
by the legacy CDK stack `CoparseApiOrganizationVPCStack` or by hand; this
stack adds to them by id and owns only what it creates:

- the S3 gateway endpoint, and the attachments of it and of the hand-made
  DynamoDB endpoint `vpce-0897d4d90eb4914f6` to every private route table;
- a NAT, Elastic IP and private route table in us-east-1b and us-east-1c;
- the route table associations of the hand-made private subnets 3, 4 and 5
  (adopted with `import`). The CDK subnets keep their CDK associations.

## Rollout switches (`Pulumi.prod.yaml`)

1. `adoptSubnetAssociations: true`, `zonalEgressZones: []`: creates the NATs
   and route tables and imports the associations unchanged. No traffic moves.
2. Deploy `computers-dev-gateway` (dev) so the new route tables get its `/32`.
3. `adoptSubnetAssociations: false` and add one zone at a time to
   `zonalEgressZones`. Each deploy re-points that zone's subnets.

Rollback: remove the zone from `zonalEgressZones` and deploy, or
`aws ec2 replace-route-table-association` back to the shared table.

## Gotchas

- Only a `prod` stack exists, and it changes dev traffic too: dev services use
  the same subnets and route tables.
- Re-pointing a subnet is instant and drops its open connections through the
  old NAT; adding an endpoint does the same for S3/DynamoDB connections.
- Associations are `retainOnDelete`: deleting one would drop the subnet onto
  the main route table, which has no default route.
- `privateRouteTableIds` is keyed by `PRIVATE_ROUTE_TABLE_KEYS`
  (`packages/vpc`); `computers-dev-gateway` reads it with a stack reference,
  so a new route table appears there on its next deploy.
- Gateway endpoints cover same-region (`us-east-1`) S3 buckets only.
- Not in `services-config.json`; deploys are manual
  (`pulumi preview --stack macro-inc/prod`, then `up` with permission).

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/vpc-network`.
