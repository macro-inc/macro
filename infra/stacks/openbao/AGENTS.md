# openbao stack

## What it is

Hosted OpenBao for Passwords, dev only. It runs as one Fargate task with Raft
on EFS, and an internal ALB sits in front of it. `README.md` is the operations
guide; [the Pulumi rule](../../../.agents/rules/infra/pulumi.md) covers deploys.

## Start here

- `index.ts`: the whole stack.
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
