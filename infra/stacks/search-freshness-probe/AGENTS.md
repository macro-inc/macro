# search-freshness-probe stack

## What it is

ECS service for `services/search_freshness_probe`: one task that acts as the
probe user through the public gateway. Nothing calls it: no load balancer, no
gateway route, no service URL, and a task role with no AWS permissions. Egress
is 443 only.

## Config (Doppler project `search-freshness-probe`, `dev` and `prd`)

`PROBE_USER_API_KEY`, the key of the environment's dedicated probe user. This
stack writes nothing to Doppler. Prod runs no task until `RUNS_IN_PROD` in
`service.ts` is set.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/search-freshness-probe`.

## Gotchas

- One task, replaced stop-first (`deploymentMinimumHealthyPercent: 0`): two
  probes would rename the same fixtures and report each other's titles as
  misses. The stop timeout is 90 s so shutdown can finish a write and delete
  what the probe made.
- No ECS container health check: the runtime image has no HTTP client. The
  `search-probe-silent` monitor notices a probe that stops.
- Deploys need the `doppler-projects` stack applied first: `DopplerEcsEnvironment`
  reads `/doppler-sync/search-freshness-probe/<stack>`.
- Once it runs in prod, set `PROBE_RUNS_IN_PROD` in
  `infra/stacks/monitoring/monitors/search-freshness.ts` so its heartbeat
  monitor exists, and add `search-probe-silent` to both monitor lists in
  `infra/stacks/monitoring/routing.test.ts` (prod monitors and heartbeats).

## Related

- Docs: `docs/development/infrastructure.md`, `docs/guides/new-service.md`
