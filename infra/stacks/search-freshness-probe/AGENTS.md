# search-freshness-probe stack

## What it is

ECS service for `services/search_freshness_probe`: one task that acts as the
probe user through the public gateway. Nothing calls it: no load balancer, no
gateway route, no service URL, and a task role with no AWS permissions. Egress
is 443 only.

## Config (Doppler project `search-freshness-probe`, `dev` and `prd`)

`PROBE_USER_API_KEY`, the probe user's key in that environment. This stack
writes nothing to Doppler. `bootstrap_pending` in `.github/services-config.json`
keeps it undeployed until both configs hold the key.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/search-freshness-probe`.

## Gotchas

- One task, replaced stop-first (`deploymentMinimumHealthyPercent: 0`): two
  probes would rename the same fixtures and report each other's titles as
  misses.
- No ECS container health check: the runtime image has no HTTP client. The
  `search-probe-silent` monitor notices a probe that stops.
- Deploys need the `doppler-projects` stack applied first: `DopplerEcsEnvironment`
  reads `/doppler-sync/search-freshness-probe/<stack>`.
- Once it runs in prod, set `PROBE_RUNS_IN_PROD` in
  `infra/stacks/monitoring/monitors/search-freshness.ts` so its heartbeat
  monitor exists.

## Related

- Docs: `docs/development/infrastructure.md`, `docs/guides/new-service.md`
