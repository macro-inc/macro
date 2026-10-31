# T012: Deploy stack and local stack for `connect_api`

Independent of T006-T010; base on the integration branch.

## Goal

`connect_api` can be deployed to dev and prod by Macro's existing pipeline,
and runs in Macro's local stack so Macro services can call it, with nothing
deployed by this task.

## Context

- `docs/guides/new-service.md`: follow sections 2 (deploy inventory),
  3 (infrastructure), 4 (config and secrets), 5 (service discovery), 6 (local
  stack), and "Verify locally". Model: `services/calendar_service` +
  `infra/stacks/calendar-service`.
- `docs/development/infrastructure.md`.
- Names: crate `connect_api` at `connect/services/connect_api`; everywhere
  else `connect-api` (services-config, nix `serviceName`, Pulumi project,
  Doppler project `connect-api`). Doppler project `connect` already exists and
  holds operations secrets (the `connect@macro.com` account); runtime config
  goes in `connect-api`.
- Connect runs on Macro's platform for v1 (shared pipeline, gateway, RDS
  instance); its code still depends on no Macro crate ([decision](../docs/decisions.md)).

## Do

1. **Deploy inventory** per section 2, with `"bootstrap_pending": "Doppler
   project connect-api, database, and first deploy pending Eric's approval"`.
   Add `connect/services/connect_api/**` and `connect/crates/**` to
   `source_paths`.
2. **Infrastructure** per section 3: `infra/stacks/connect-api/` copied from
   `calendar-service`; gateway member with prefix `/connect` (check
   priorities); a dedicated KMS key for grant envelopes whose policy lets only
   the service's task role `Encrypt`/`Decrypt`/`GenerateDataKey`, with the key
   id passed as `CONNECT_KMS_KEY_ID`; alarms as calendar's. The database is a
   separate `connect` database on the existing RDS instance: write a short
   runbook in `connect/docs/runbooks/database.md` for creating it and its
   role (a human runs it), and pass its URL as `DATABASE_URL` through
   Doppler. Add `connect-api` to `SERVICE_NAMES` in
   `infra/stacks/doppler-projects/index.ts`.
3. **Config** per section 4: list every key `connect_api` reads in
   `connect/services/connect_api/AGENTS.md`; `BootStubEnv` placeholders in
   `local_env.rs`; a `doppler_config` binary like `services/contacts_service`'s.
   Create no Doppler values.
4. **Service discovery** per section 5: `service_url!` entry `ConnectApi`
   (`local` `http://localhost:<port>`, `dev`/`prod` the gateway `/connect`
   URLs) and its copies (`infra/packages/shared/src/service_urls.ts`; not the
   web app, which reaches Connect through Macro's backend and the browser
   redirect).
5. **Local stack** per section 6: compose block, `RustService` inventory
   entry, `Port` variant at the end, a local Postgres database `connect` with
   migrations applied at startup, and `CONNECT_LOCAL_WRAPPING_KEY` /
   `CONNECT_PUBLIC_URL` local values.
6. **Migrations at startup**: `connect_api` runs its SQLx migrations on boot
   (Connect owns its database).

## Done when

- The "Verify locally" commands from the guide pass, including
  `curl http://localhost:<port>/health` and through the local proxy at
  `/connect/health`.
- `cargo x deps --check`, `cargo x workflows --check`, `just check full` pass.
- `cd infra && bun install && bunx tsc -p stacks/connect-api` (or the repo's
  infra type check) passes.

## Out of scope

Deploying, `pulumi up`, creating Doppler values or the database, DNS for a
custom domain.

## Result

Implemented, uncommitted, with no deploy or production change.

### Changed files

- Deploy inventory and build: `.github/services-config.json`, `.github/workflows/deploy-service-generic.yml`, `nix/cloud-storage.nix`.
- Pulumi and Doppler project wiring: `infra/stacks/connect-api/` (including its `AGENTS.md` and `CLAUDE.md` symlink), `infra/stacks/doppler-projects/index.ts`, `infra/packages/shared/src/gateway_priorities.ts`, `infra/packages/shared/src/service_urls.ts`, `infra/bun.lock`.
- Connect runtime and guidance: `connect/services/connect_api/Cargo.toml`, `connect/services/connect_api/src/doppler_config.rs`, `connect/services/connect_api/src/main.rs`, `connect/services/connect_api/src/test.rs`, `connect/services/connect_api/AGENTS.md`, `connect/docs/runbooks/database.md`, `connect/AGENTS.md`, `Cargo.lock`.
- Service discovery and local stack: `crates/macro_service_urls/src/lib.rs`, `crates/macro_service_urls/AGENTS.md`, `docker/Dockerfile.dev`, `docker/docker-compose.yml`, `tooling/xtask/crates/xtask_local/src/local/{instance.rs,inventory.rs,inventory/test.rs,local_env.rs}`.

The stack owns `/connect` on the shared gateway, with a dedicated rotation-enabled KMS key whose cryptographic actions are granted to the Connect task role. The Connect database is created separately on the existing local Postgres instance; `connect_api` applies its SQLx migrations on startup. The runbook describes human creation of the deployed database and role and the Doppler values; none were created here.

### Checks

- `cargo build -p connect_api`: passed.
- `cargo test -p connect_api`: passed, 8 tests. `cargo nextest run --all-features -p connect_api`: passed, 8 tests.
- `cargo test -p macro_service_urls`: passed, 47 unit tests and 1 doc test. `cargo test -p xtask_local`: passed, 124 tests.
- `cargo x deps --check`: passed. `cargo x workflows --check`: passed; generated workflows are current.
- `just rust-check`: passed. `just clippy`: passed. `cargo clippy -p connect_api --all-features --all-targets -- -D warnings`: passed. `cargo fmt --all -- --check`: passed.
- `just check full`: passed. `just check`: passed. Both required a writable temporary `XDG_RUNTIME_DIR` and a temporary ELF interpreter fix for the downloaded ast-grep binary on NixOS; no repository file was changed for that workaround.
- `cd infra && bun install && bunx tsc -p stacks/connect-api`: passed. Infra `bun run check` and Biome on the changed TypeScript files: passed.
- `nix-instantiate --parse nix/cloud-storage.nix`, `docker compose --project-directory . -f docker/docker-compose.yml config --quiet`, and `git diff --check`: passed.
- `just stack up --instance t012deploy --no-frontend --no-doppler --traces off --json`: passed; isolated local stack ready and `connect_api` healthy. `curl http://localhost:24533/health`: HTTP 200. `curl --cacert infra/local/certs/ca.pem https://localhost:24509/connect/health`: HTTP 200.

Rust and repository tooling ran inside `nix develop --command` with the required `CARGO_TARGET_DIR` and `DATABASE_URL` exports. The initial stack attempt could not write Docker Buildx activity under the read-only home directory; the successful run used a writable temporary `DOCKER_CONFIG`.

### Open questions and follow-up

No product decision is open. After approval, a human must deploy the `doppler-projects` stack to create the dev and prod `connect-api` configurations, populate their values, create the deployed `connect` database and role, set `CONNECT_KMS_KEY_ID` from the Pulumi output, and remove `bootstrap_pending` before the first dev deployment. Creating the key and supplying its id requires a staged first deployment; production follows the normal release process. No part of that deployment was performed here.

### Proposed commit

`feat(connect): wire API deploy and local stacks`

Why: Connect needs its own deploy inventory, runtime configuration, service discovery, database, and local stack integration before Macro can call it.

What: Add the gateway backed Pulumi stack and KMS key, register the service in build and local tooling, create the local database and runtime config validation, and document the human database setup.
