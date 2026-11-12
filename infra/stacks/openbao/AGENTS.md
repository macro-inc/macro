# openbao stack

## What it is

Hosted OpenBao for Passwords, dev only. It runs as one Fargate task with Raft
on EFS, and an internal ALB sits in front of it. `README.md` is the operations
guide; [the Pulumi rule](../../../.agents/rules/infra/pulumi.md) covers deploys.

## Start here

- `index.ts`: the whole stack.
- `server-config.ts`: the server HCL. Keep it in step with
  `infra/local/openbao/local.hcl` (request duration, Raft layout, audit device).

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/openbao`;
`pulumi preview --stack macro-inc/dev` from this directory.

## Gotchas

- Never let two tasks open the Raft volume. Keep the stop-then-start deployment
  (`minimumHealthyPercent: 0`, `maximumPercent: 100`); every deploy is a short outage.
- The seal key policy is the only grant on that key; don't add IAM policies for
  it. Losing the key makes every backup unreadable, so it stays `protect` +
  `retainOnDelete`.
- The health check accepts 501 (uninitialized) so the first deploy can settle;
  a sealed vault (503) must stay unhealthy.
- The `openbao` Doppler project has a dev config only and is created by hand.
  Don't add it to `doppler-projects`, which would also create `prd`.
- The stack is not in `services-config.json`; deploys are manual.
