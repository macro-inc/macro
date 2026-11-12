# openbao stack

## What it is

Hosted OpenBao 2.7.2 for Passwords, **dev only** (the program refuses any other
stack). It is one Fargate task with integrated Raft on EFS, AWS KMS auto-unseal,
and daily AWS Backup. It sits behind an internal ALB with an ACM certificate at
`https://openbao-dev.macro-internal.com`, reachable only from the document
storage service's security group. `README.md` is the operations guide: first
init, provisioning, restore.

## Start here

- `index.ts`: seal key, security groups, EFS + access point + backup, the
  certificate, ALB, DNS, the Fargate service, and the alarms.
- `server-config.ts`: the server HCL. It mirrors `infra/local/openbao/local.hcl`,
  except for the seal (KMS here) and the TLS-terminating ALB in front.

## Config

There is no Doppler environment on the task, because the vault reads no app
config. The upstream image's entrypoint receives the HCL as `BAO_LOCAL_CONFIG`.
Operator credentials (`OPENBAO_ROOT_TOKEN`, `OPENBAO_RECOVERY_KEY`) live in the
Doppler project `openbao`, config `dev` only. It is created by hand, not through
`doppler-projects`, because that stack also creates `prd`. The document storage
service gets `OPENBAO_ADDRESS`, `PASSWORDS_JWT_ISSUER`, and
`PASSWORDS_JWT_SIGNING_KEY` in its own Doppler project (`cloud-storage-service`,
`dev`).

`OPENBAO_ADDRESS` is a stable URL kept in Doppler, which deviates from the
service-URL rule because the Passwords config reads it that way. Move it to a
typed `macro_service_urls` entry when prod lands.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/openbao`, and
`pulumi preview --stack macro-inc/dev` from this directory.

## Gotchas

- Deploys are manual and dev-only; this stack is deliberately not in
  `services-config.json`. Never `pulumi up` without explicit permission.
- Never run two tasks on the volume: the deployment is stop-then-start
  (`minimumHealthyPercent: 0`, `maximumPercent: 100`), so every deploy is a short
  outage.
- The seal key, the EFS file system, and the backup vault are `protect` +
  `retainOnDelete`. Losing the seal key makes every backup unreadable.
- The health check treats 501 (uninitialized) as healthy so the first deploy can
  settle before `operator init`. 503 (sealed) is unhealthy.
- The ALB terminates TLS; the task listens on plain HTTP 8200, reachable only from
  the ALB's security group.
- Raft on EFS is a dev compromise. See README "Prod later".
