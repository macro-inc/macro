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

The only key is `DATABASE_URL` = `${global_databases.<config>.DATABASE_URL}`,
set with the Doppler CLI. That URL is the MacroDB **instance** endpoint
(`macro-db-<stack>`), which the advisory-lock connection needs; never the RDS
Proxy (`macrodb-proxy-<stack>`).

The service computes the KMS alias from `ENVIRONMENT`
(`SessionKmsKey` in its `src/config.rs`): `alias/whatsapp-session-service-<stack>`,
the name `service.ts` creates. A test there checks the two agree. This stack
writes nothing to Doppler.

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
- Egress allows only 443, so the FireLens Datadog output sets `TLS on` and
  `Port 443`; Fluent Bit's default is plain HTTP on 80, which times out and
  drops every application log.
- No ECS container health check: the runtime image has no HTTP client. A
  replica that loses its lock connection must exit non-zero so ECS replaces it.
- No autoscaling: replicas own accounts, so scaling in forces takeovers. The
  task count is `desiredCount` in `service.ts`: 2 in prod, so a deploy hands
  leases to a running replica instead of dropping them, and 1 in dev. Prod
  deploys with each published release (`release-production.yml` →
  `deploy_all_services.yml`, after the MacroDB migrations); dev on merge.
- The KMS key only answers calls whose encryption context has
  `macro:purpose = whatsapp-session` (`crates/whatsapp_store_pg/src/kms.rs`).
  Changing that string strands every stored session.
- Deploys need the `doppler-projects` stack applied first: `DopplerEcsEnvironment`
  reads `/doppler-sync/whatsapp-session-service/<stack>`, which its sync writes.
- To stop all WhatsApp traffic, scale the ECS service to 0 like any service;
  the next deploy restores the count in `service.ts`. See the service runbook.

## Related

- Rules: `.agents/rules/infra/pulumi.md`, `.agents/rules/config-and-service-urls.md`
- Docs: `docs/development/infrastructure.md`, `docs/guides/new-service.md`
