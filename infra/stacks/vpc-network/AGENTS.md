# vpc-network stack

## What it is

Routing and gateway endpoints of `vpc-0c7510191d4fc9263` (coparse-api-vpc),
the one VPC every dev and prod service runs in. The VPC, subnets, internet
gateway, NAT and the private route tables were made by the legacy CDK stack
`CoparseApiOrganizationVPCStack` or by hand; this stack adds to them by id
and owns only what it creates:

- the S3 gateway endpoint, attached to every private route table;
- the attachments of the hand-made DynamoDB gateway endpoint
  `vpce-0897d4d90eb4914f6` to those route tables.

## Gotchas

- Only a `prod` stack exists, and it changes dev traffic too: dev services use
  the same subnets and route tables.
- A new private route table must get both endpoint attachments, or its S3 and
  DynamoDB traffic pays NAT processing again.
- Adding an endpoint route moves existing S3/DynamoDB connections off the NAT;
  in-flight requests through the NAT reset and the SDKs retry them.
- Gateway endpoints cover same-region (`us-east-1`) S3 buckets only.
- `computers-dev-gateway` adds its `/32` route to the private route tables.
- Not in `services-config.json`; deploys are manual
  (`pulumi preview --stack macro-inc/prod`, then `up` with permission).

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/vpc-network`.
