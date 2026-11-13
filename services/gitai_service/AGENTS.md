# gitai_service

## What it is

Macro's self-hosted server for the open-source git-ai client: engineers' git-ai
daemons upload metrics, notes and agent transcripts to it, and agents read
attribution back through its API. Only `github.com/macro-inc/macro` is
accepted. This crate is the composition root; the logic lives in
`crates/gitai`.

## Start here

- `src/main.rs`: config, AWS clients, adapters, router at `/` and `/gitai`.
- `src/config.rs`: every key the service reads from Doppler `gitai-service`.

## Scope

- Owns: startup wiring, config, the Doppler contract check
  (`gitai_service_doppler_config`).
- Not here: handlers, use cases, storage adapters → `crates/gitai`.
- Callers: the git-ai client (`/worker/*`, `X-API-Key` device credential),
  agents and operators (`/v1/*`), the gateway health check (`/health`).

## Config

- `GITAI_SHARED_KEY` (set by hand): mints device credentials; never on a laptop.
- `GITHUB_TOKEN` (optional, set by hand): squash-merge pull request lookups.
- `GITAI_EVENTS_BUCKET`, `GITAI_SESSIONS_BUCKET`, `GITAI_TABLE`: written into
  Doppler by `infra/stacks/gitai-service` (`doppler.Secret`).
- Repository allowlist and pinned client version are constants in
  `gitai::domain::models`, not config.

## Local stack

Runs in every `just run_local` (Local mode; not `run_dev`). Host port is the
instance's `Gitai` port (8113 on the default instance), proxied at
`https://localhost:<proxy>/gitai`. LocalStack holds `gitai-events`,
`gitai-sessions` and the `gitai-service-index` table (`resources.rs`).

## Checks

- `cargo clippy -p gitai_service -p gitai --tests`
- `cargo test -p gitai`
- `curl http://localhost:<Gitai port>/gitai/health`

## Gotchas

- `.github/services-config.json` has `bootstrap_pending` until a person creates
  the Doppler `dev`/`prd` values, deploys `doppler-projects`, sets
  `doppler:dopplerToken` (secure) in both `Pulumi.<stack>.yaml` files of
  `infra/stacks/gitai-service`, and runs the first deploy.
- The ALB forwards `/gitai/...` unchanged, so routes are mounted twice.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Docs:
  `docs/guides/new-service.md`
