# openbao stack

## What it is

Hosted OpenBao for Passwords, dev only. It runs as one Fargate task with Raft
on EFS, and an internal ALB sits in front of it. `README.md` is the operations
guide; [the Pulumi rule](../../../.agents/rules/infra/pulumi.md) covers deploys.

## Start here

- `index.ts`: the whole stack.
- `server-config.ts`: the server HCL. Keep its request duration, Raft layout
  and audit device in step with the Passwords local OpenBao config.

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
- OpenBao 2.7 has no built-in AWS KMS seal. `server-config.ts` loads the
  `kms-aws` plugin from ghcr.io into `plugins/`, a sibling of the Raft `data/`
  directory. On a version bump, update both the image digest and the binary
  sha256 from the official openbao/openbao-plugins release.
