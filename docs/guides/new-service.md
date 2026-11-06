# Creating a new service

A new deployable service is registered in about a dozen places. Each section below
is one place, in the order you'll reach it. Most past launches missed at least one
and needed a follow-up fix; those misses are called out inline.

> **Agents never deploy.** Everything here is code and config in a PR. The first
> deploy, Doppler secrets, and DNS are done by a person or on their explicit
> request. See the [infrastructure guide](../development/infrastructure.md).

## Pick a model to copy

| Building | Copy | Why |
| --- | --- | --- |
| HTTP service behind the gateway | `services/calendar_service` + `infra/stacks/calendar-service` | Newest full example: own stack, gateway route, local stack, OpenAPI, web and SDK clients |
| SQS worker, no port | `services/slack_import_worker` | No router, opt-in locally, deployed inside an existing stack |
| Kafka consumer | `services/agent_trigger_service` | `KafkaConsumerAdapter` with explicit offset commits |
| Cloudflare Worker | `services/cla-worker` | Wrangler, generated deploy workflow; none of the Rust, ECS, or Doppler steps apply |

Names: the crate is `snake_case` (`calendar_service`); everything else uses the
kebab-case name (`calendar-service`) and it must be **identical** across
`services-config.json`, the nix `serviceName`, the Pulumi project name, and the
Doppler project. Calendar's `DOPPLER_PROJECT: 'calendar_service'` env var is the
cautionary example.

## 1. The crate

- Create `services/<snake_name>/` and add it to `members` in the root
  `Cargo.toml`. Third-party dependencies use `{ workspace = true }`; add
  `workspace-hack = { version = "0.1", path = "../../crates/workspace-hack" }`.
- Run `just hakari` (`cargo x deps`) and commit the regenerated
  `crates/workspace-hack` and `.github/workspace-dep-closures.json`. CI and nix both
  fail without it.
- The binary is a composition root. Domain logic goes in `crates/<domain>` with
  `inbound/`, `domain/`, and `outbound/` (see the
  [hexagonal architecture skill](../../.agents/skills/cloud-storage-hexagonal-architecture/SKILL.md)).
- If it uses `sqlx::query!`, run `nix develop --command just prepare_db` and commit
  the root `.sqlx/` ([database guide](../development/database.md)).

### `main.rs`, in order

Follow `services/calendar_service/src/main.rs`, except that `main` returns
`Result<(), rootcause::Report>` (CS-56; calendar still returns `anyhow::Result`):

1. `MacroEntrypoint::default().init()` first. Keep the returned handle and call
   `.shutdown()` before exit so telemetry flushes.
2. Load config once: a `#[derive(MacroConfig)]` struct in `src/config.rs`, loaded
   with `macro_config::ConfigLoader::load`. See the
   [config rule](../../.agents/rules/config-and-service-urls.md).
3. Build clients: `macro_aws_config`, Postgres pool, `XServiceUrl::new()` for every
   service you call.
4. If the binary dials TLS through rustls directly (not via `reqwest`), install the
   `aws_lc_rs` crypto provider before anything else, or rustls panics.
5. Auth state (`MacroAuthorizationState`, internal API key, user API keys).
6. Router: `TraceLayer`, `macro_cors::cors_layer()`, compression; state via `State`,
   not `Extension`. Mount it at `/` **and** under `/<prefix>`, because the gateway
   forwards the path unchanged.
7. `GET /health` returning 200, matching the Pulumi and compose health checks.
8. Graceful shutdown: `axum::serve(..).with_graceful_shutdown(shutdown_signal())`;
   background tasks on a `CancellationToken` + `TaskTracker`; drain the Kafka
   publisher with a timeout.

Listen on `8080` by default; the Dockerfile sets `PORT=8080`.

## 2. Deploy inventory

- **`.github/services-config.json`:** add `"<kebab-name>": { source_paths,
  stack_path, deploy_binaries }`. Add `"bootstrap_pending": "<reason>"` until the
  Doppler project and first deploy exist; CI skips the service while it's set.
- **`nix/cloud-storage.nix`:** add `{ serviceName; packageName; binaries }` to
  `deployServiceBinaryDefinitions`, and to `localStackDeployServiceNames` if it
  runs locally. *Missed by both calendar and the Slack import worker;* the deploy
  fails at `nix build .#deploy-service-binaries-<name>`. Files you `include_str!`
  must also match the nix `assetFilter`.
- **`.github/workflows/deploy-service-generic.yml`:** add the name to the dispatch
  list. It's hand-maintained and was forgotten twice.
- If you changed a workflow generator, run `cargo x workflows`.

## 3. Infrastructure

Follow the [infrastructure guide](../development/infrastructure.md) for the pattern itself.

- Create `infra/stacks/<kebab-name>/` (`Pulumi.yaml`, `Pulumi.dev.yaml`,
  `Pulumi.prod.yaml`, `package.json`, `tsconfig.json`, `index.ts`, `service.ts`) by
  copying `calendar-service`, and update `infra/bun.lock`.
- **Doppler project:** add the name to `SERVICE_NAMES` in
  `infra/stacks/doppler-projects/index.ts`. Until that stack is deployed and the
  project has `dev`/`prd` values, a deploy can't read its secret; keep
  `bootstrap_pending` set.
- **Gateway:** add a `GatewayService` member and a unique priority in
  `infra/packages/shared/src/gateway_priorities.ts`, then a `ServiceTargetGroup`.
  Check that no existing rule with a lower number matches your prefix.
- Queues with the `Queue` component, Kafka access with `getKafkaClusterPolicy()`,
  alarms copied from `calendar-service/service.ts`.

## 4. Config and secrets

- Put every key the service reads into Doppler `<kebab-name>` for `dev` and `prd`,
  with names identical to the code. The `doppler_config` CI check fails otherwise.
- Add the keys to the shared `local/lcl_personal` config, and a `BootStubEnv`
  placeholder in `tooling/xtask/crates/xtask_local/src/local/local_env.rs` so
  `--no-doppler` still boots.
- Add a `src/doppler_config.rs` binary like `services/contacts_service`'s so CI
  validates your config against Doppler on every change.

## 5. Service discovery

- Add a `service_url!` entry to `crates/macro_service_urls/src/lib.rs` with
  `local`, `dev`, and `prod` values.
- Add the in-network override in `local_env.rs`:
  `OVERRIDE_<NAME>_URL = http://<compose-alias>:8080`. The `local` default is a host
  port, which inside Docker points back at the caller.
- If the frontend calls it, add it to `serverHostLocal`, `directServerHostRemote`, and
  `proxyServers()` in `apps/web/src/lib/core/constant/servers.ts`. A test fails if
  the proxy prefix is missing.
- If infra needs the URL, add it to `infra/packages/shared/src/service_urls.ts`.

## 6. Local stack

- `docker/docker-compose.yml`: a block using `<<: [*common-env,
  *rust-services-image]`, `command: ["/app/out/<bin>"]`, a network alias, a
  `/health` healthcheck, and a port. Workers with no port go under a `profiles:`
  entry.
- `tooling/xtask/crates/xtask_local/src/local/inventory.rs`: a `RustService` entry,
  and bump the count in `inventory/test.rs`. A worker that consumes shared queues
  must be `opt_in` or `modes: &[Mode::Local]`, or `run_dev` steals dev messages.
- `local/instance.rs`: add the `Port` variant **at the end**; offsets come from
  declaration order.
- `local/resources.rs` and `crates/macro_queues`: any queue or bucket the service
  needs. A worker whose queue doesn't exist locally spins in a tight loop.

## 7. API clients (HTTP services)

- Add a `<crate>_openapi` binary (`src/openapi.rs`).
- Web: `serviceToCrate` in `apps/web/scripts/generate-api-schema.ts`, an entry in
  `apps/web/scripts/services.ts`, an orval target in
  `apps/web/src/lib/service-clients/orval.config.ts`, and a path alias in
  `apps/web/tsconfig.json`.
- SDK: follow the [add-sdk-endpoint skill](../../.agents/skills/add-sdk-endpoint/SKILL.md),
  including `ACCESSORS` in `src/coverage/check.ts`, then `just coverage`.

## 8. Kafka topics (only if you add one)

Add it to the `topics!` list in `crates/macro_event_topics/src/lib.rs` and run
`cargo x kafka-topics`. Never hand-edit `.github/kafka-cluster-topics.json`.

## Verify locally

```sh
cargo build -p <package>
just rust-check && just clippy
cargo test -p <package>                 # with SQLX_OFFLINE unset
cargo x deps --check && cargo x workflows --check
just run_local                          # or just stack up
curl http://localhost:<port>/health
curl https://localhost:8090/<prefix>/health   # through the local proxy
```

Use the `live-debug` skill for traces and logs. For opt-in workers, start the
compose profile.

## After merge

A person (or an agent on explicit request) creates the Doppler values, deploys
`doppler-projects`, removes `bootstrap_pending`, and lets the next push to `main`
deploy dev. Production follows the next release.
