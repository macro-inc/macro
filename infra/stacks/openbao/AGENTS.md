# openbao stack

## What it is

Hosted OpenBao for Passwords, dev only. It runs as one Fargate task with Raft
on EFS. Two vaults exist during the move to the `macro-openbao` account: the
legacy one in the main account's shared VPC behind an internal ALB, which still
serves DSS, and its replacement in the OpenBao account, behind an NLB that DSS
reaches through PrivateLink. `README.md` is the operations
guide; [the Pulumi rule](../../../.agents/rules/infra/pulumi.md) covers deploys.

## Start here

- `index.ts`: the legacy vault, which creates the `AccountVault` component.
- `vault.ts`: the replacement in the OpenBao account, plus its main-account
  pieces (PrivateLink endpoint, certificate validation, logs destination).
- `account.ts`: the OpenBao account ID and the one provider for it
  (`openbaoAccount`). Every file creating resources there imports it.
- `network.ts`: the replacement's VPC and AWS endpoints.
- `constants.ts`: names and ports both vaults share.
- `server-config.ts`: the server HCL. Keep its request duration, Raft layout
  and audit device in step with the Passwords local OpenBao config.
- `image/Dockerfile`: our image, upstream OpenBao plus the AWS KMS seal plugin.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/openbao`;
`pulumi preview --stack macro-inc/dev` from this directory.

## Gotchas

- Never let two tasks open the Raft volume. Keep the stop-then-start deployment
  (`minimumHealthyPercent: 0`, `maximumPercent: 100`); every deploy is a short outage.
- The seal key policy is the only grant on that key; don't add IAM policies for
  it. Losing the key makes every backup unreadable, so it stays `protect` +
  `retainOnDelete`.
- The health check asks for `uninitcode=200` so the first deploy settles before
  init (ALB matchers stop at 499); a sealed vault (503) must stay unhealthy.
- The `openbao` Doppler project has a dev config only and is created by hand.
  Don't add it to `doppler-projects`, which would also create `prd`.
- The stack is not in `services-config.json`; deploys are manual.
- OpenBao 2.7 has no built-in AWS KMS seal. `image/Dockerfile` copies the
  `kms-aws` plugin from its digest-pinned image into `/usr/lib/openbao/plugins`;
  `server-config.ts` runs it by `command` and checks its sha256. Never turn on
  `plugin_auto_download` or pull anything at runtime: the task needs only AWS
  APIs. On a version bump, update the image digests in the Dockerfile and the
  linux_amd64 sha256 from the official openbao/openbao-plugins release together.
- No `withTelemetry`: its sidecars pull from Docker Hub and public ECR and send
  to Datadog and Grafana over the internet. Logs use the `awslogs` driver into
  the `openbao` log group, which the shared Firehose forwards to Datadog.
- Task egress is still HTTPS to `0.0.0.0/0`: the shared VPC (dev and prod)
  routes through a NAT and has no interface endpoints, and adding private-DNS
  endpoints there would reroute every prod service. Don't add those here; the
  lockdown comes with OpenBao's own VPC (README "Network").
- The ALB admits only the document storage service and the OpenBao task's own
  security group (the operator SSM tunnel, README "Operator tunnel"). Never add
  CIDR ingress.
- In `vault.ts`, every resource on the vault side passes the OpenBao account
  provider and the component as parent. Main-account pieces use the default provider. Each IAM role gets
  `path: ROLE_PATH` and `permissionsBoundary`, and each name includes the
  environment: the deploy role can create nothing else. Never add an internet
  or NAT gateway (the SCPs deny them anyway) or a `0.0.0.0/0` rule; a new AWS
  API the task calls gets an endpoint in `network.ts`. Keep the endpoints'
  `aws:PrincipalAccount` policies and the DNS firewall's AWS-only allowlist:
  they stop data leaving through another account's credentials or through DNS.
- DSS's PrivateLink endpoint admits only the document storage service. The NLB
  skips its own inbound rules for PrivateLink traffic, so that endpoint's
  security group is the control.
- PrivateLink zones match by zone ID (`ZONES` in `network.ts`). Zone names
  differ between accounts.
