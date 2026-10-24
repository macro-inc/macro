# whatsapp-session-service stack

## What it is

ECS service for `services/whatsapp_session_service`: personal WhatsApp linked
devices, one outbound websocket per account, leased between replicas with
Postgres advisory locks. Nothing calls it: no load balancer, no gateway route,
no service URL. Egress is 443 (WhatsApp, AWS APIs, Datadog) and 5432 (MacroDB).

## Start here

- `service.ts`: KMS key, security group, task definition, rolling deployment.
- `infra/stacks/monitoring/monitors/whatsapp-session.ts`: its Datadog monitors
  and the telemetry they expect.

## Config (Doppler project `whatsapp-session-service`, `dev` and `prd`)

| Key | Value |
| --- | --- |
| `DATABASE_URL` | Pooled MacroDB URL, as other services. |
| `WHATSAPP_SESSION_LOCK_DATABASE_URL` | MacroDB **instance** endpoint (`macro-db-<stack>`, the `macrodb` stack's `endpoint` output), never the RDS Proxy (`macrodb-proxy-<stack>`). |
| `WHATSAPP_SESSION_KMS_KEY_ID` | `alias/whatsapp-session-service-<stack>` (`sessionKmsKeyAlias` output). |
| `WHATSAPP_SESSION_MAX_ACCOUNTS` | `500` |
| `WHATSAPP_SESSION_DRAIN_BATCH` | `20` |

The KMS key id is set by hand, not by Pulumi: `MacroConfig` reads only
`APP_SECRETS_JSON` in ECS. Local values come from `xtask_local` (`local_env.rs`).

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/whatsapp-session-service`.

## Gotchas

- Session advisory locks and `LISTEN` live on one Postgres session. RDS Proxy
  multiplexes, pins, and closes idle client connections (`IdleClientTimeout`);
  losing that session silently drops every lock the replica holds. Keep the
  lock connection outside transactions too: MacroDB sets
  `idle_in_transaction_session_timeout` to 5 minutes.
- Budget connections: each replica holds its pool plus the direct lock
  connection; during a deploy (`maximumPercent: 200`) double the replicas.
- `stopTimeout` is Fargate's 120 s maximum and the sidecars match it; the app
  container depends on them so they stop last and the drain's logs and spans
  ship. Drain must finish inside 120 s.
- No ECS container health check: the runtime image has no HTTP client. A
  replica that loses its lock connection must exit non-zero so ECS replaces it.
- No autoscaling: replicas own accounts, so scaling in forces takeovers. Change
  `desired_count` in `Pulumi.<stack>.yaml`.
- The KMS key only answers calls whose encryption context has
  `macro:purpose = whatsapp-session` (`crates/whatsapp_store_pg/src/kms.rs`).
  Changing that string strands every stored session.
- `bootstrap_pending` in `.github/services-config.json` keeps it out of
  deploys until the Doppler project exists and someone enables it.

## Related

- Rules: `.agents/rules/infra/pulumi.md`, `.agents/rules/config-and-service-urls.md`
- Docs: `docs/development/infrastructure.md`, `docs/guides/new-service.md`
