---
description: Pulumi changes follow the current ECS/gateway/Doppler pattern, and agents never deploy.
paths:
  - "infra/**"
  - ".github/services-config.json"
  - "**/wrangler.toml"
  - "**/wrangler.jsonc"
globs: infra/**,.github/services-config.json,**/wrangler.toml,**/wrangler.jsonc
alwaysApply: false
---

# Pulumi and deploys

Read the [infrastructure guide](../../../docs/development/infrastructure.md)
before changing a stack.

- Never run `pulumi up`/`destroy`, `wrangler deploy`/`secret put`, or dispatch a
  deploy workflow unless the user asked for that deploy in this conversation.
  `pulumi preview` is fine.
- Copy the current pattern (`calendar-service`, `lexical-service`): gateway
  `ServiceTargetGroup` with a unique `GATEWAY_PRIORITIES` entry,
  `DopplerEcsEnvironment`, `EcrImage`, Fargate with the circuit breaker. Not
  per-service ALBs, raw `aws.sqs.Queue`, or `createServiceRole`.
- `MacroConfig` sees only `APP_SECRETS_JSON` in ECS: values infra produces go
  into Doppler, not container `environment:`.
- Secrets live in the service's Doppler project, nowhere else. Don't create
  Secrets Manager secrets by hand or reference them from Pulumi config; that is
  the old pattern. Never put a resolved `secretString` in an env var.
- Generated files (`.github/kafka-cluster-topics.json`, workspace closures) are
  regenerated with `cargo x`, never hand-edited.
- New queues or buckets also go in `xtask_local`'s `resources.rs`.

Check: `bun run --cwd infra check` and Biome pass; a new stack is listed in
`services-config.json` or deliberately manual.
