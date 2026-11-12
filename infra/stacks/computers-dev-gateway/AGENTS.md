# computers-dev-gateway stack

## What it is

A WireGuard gateway, dev only, that lets the dev agent harness (Fargate, which
cannot run WireGuard) reach the dev computers host's Incus API at
`https://10.200.0.2:8443` in the `macro-computers` GCP VPC. One `t4g.nano`
(Amazon Linux 2023) with an Elastic IP sits in a public subnet. The private
subnets' route tables send `10.200.0.2/32` to its interface; it forwards only
TCP 8443 into `wg0` and masquerades as `10.99.0.1`. The deploy rules are in
[the Pulumi rule](../../../.agents/rules/infra/pulumi.md).

## Start here

- `index.ts`: the whole stack.
- `user-data.sh`: first-boot setup (WireGuard config and nftables). It holds
  no secrets; the private key is read from SSM at boot.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/computers-dev-gateway`;
`pulumi preview --stack macro-inc/dev` from this directory.

## Gotchas

- The private key is `gatewayPrivateKey` secret config, stored as an SSM
  SecureString; the instance role can read only that parameter. Set it from a
  file through stdin, never on the command line.
- `hostEndpointAddress` is runtime-dev-1's ephemeral external IP. When it
  changes, update the config; the user data changes and the instance is replaced.
- The private route tables are shared with prod. The route is a `/32` for the
  host only, and the gateway's security group admits only the dev harness.
- The host side (its peer config and the GCP firewall rule for UDP 51820 from
  the Elastic IP) lives outside this stack.
- The stack is not in `services-config.json`; deploys are manual.
- Debug with Session Manager (`aws ssm start-session --target <instance>`);
  there is no SSH.
