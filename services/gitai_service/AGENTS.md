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

## Endpoints

All also under `/gitai`. Details and the storage layout: `crates/gitai/AGENTS.md`.

| Route | Key | Does |
| --- | --- | --- |
| `POST /v1/credentials` `{email, hostname}` | shared | Mint a device credential (201, shown once) |
| `GET /v1/credentials`, `DELETE /v1/credentials/{id}` | shared | List, revoke (204) |
| `GET /v1/whoami` | device | `{id, email, hostname}` |
| `POST /worker/metrics/upload` | device | Ingest; `{"errors":[]}` |
| `POST /worker/logs/upload` | device | Summarized in a log event, not stored |
| `POST /worker/notes/upload`, `GET /worker/notes/?commits=` | device | Notes of indexed commits |
| `POST /worker/cas/upload`, `GET /worker/cas/?hashes=` | device | Acknowledged, not stored |
| `GET /worker/releases` | device | Every channel offers pinned v1.7.6 |
| `GET /worker/releases/{channel}/download/{file}` | none | 302 to the GitHub release asset |

`/worker/oauth/*` and `/api/*` are 404.

## Config

- `GITAI_SHARED_KEY` (set by hand): mints device credentials; never on a laptop.
- `GITHUB_TOKEN` (optional, set by hand): GitHub reads for squash merges and
  blame. Without it REST calls are unauthenticated (60 an hour) and
  `/v1/blame` answers 501. A fine-grained token with read-only access to
  public repositories (no scopes) is enough; base URL is `GithubApiUrl`.
- `GITAI_EVENTS_BUCKET`, `GITAI_SESSIONS_BUCKET`, `GITAI_TABLE`: written into
  Doppler by `infra/stacks/gitai-service` (`doppler.Secret`).
- Repository allowlist and pinned client version are constants in
  `gitai::domain::models`, not config.

## Local stack

Runs in every `just run_local` (Local mode; not `run_dev`). Host port is the
instance's `Gitai` port (8113 on the default instance), proxied at
`https://localhost:<proxy>/gitai`. LocalStack holds `gitai-events`,
`gitai-sessions` and the `gitai-service-index` table (`resources.rs`).

Rebuild after a change: `nix develop --command just run_local rebuild
--services gitai_service --instance <instance>`. The local shared key is the
`BootStubEnv` value `local-gitai-shared-key` unless Doppler `lcl_personal`
sets `GITAI_SHARED_KEY`.

## End-to-end with the real client

1. Mint: `curl -s -X POST -H 'X-API-Key: <shared key>' -d
   '{"email":"dev@example.com","hostname":"scratch"}'
   http://localhost:<Gitai port>/gitai/v1/credentials`.
2. Run the unmodified git-ai client in a scratch `HOME` with the phase 0
   harness: `run-scratch-client.sh http://localhost:<Gitai port>/gitai
   <credential>` (it never touches the real `~/.git-ai`; it makes commits in
   a macro-origin repo, an other-origin repo and a no-repo directory, with
   fake secrets in the transcripts).
3. Inspect LocalStack (`aws --endpoint-url http://localhost:<LocalStack port>`,
   credentials `test`/`test`): objects under `gitai-events` and
   `gitai-sessions`, items in `gitai-service-index`; nothing for
   `someone-else/other`, no fake secret unmasked.
4. `DELETE` the credential; the client's next upload gets 401.

## Checks

- `cargo clippy -p gitai_service -p gitai --tests --all-features`
- `cargo nextest run --all-features -p gitai -p gitai_service`
- `curl http://localhost:<Gitai port>/gitai/health`

## Gotchas

- `.github/services-config.json` has `bootstrap_pending` until a person deploys
  `doppler-projects`, sets the Doppler values, commits `doppler:dopplerToken`
  (secure) in both `Pulumi.<stack>.yaml` files of `infra/stacks/gitai-service`,
  and runs the first deploy; see the runbook.
- The ALB forwards `/gitai/...` unchanged, so routes are mounted twice.

## Related

- Rules: `.agents/rules/config-and-service-urls.md` · Docs:
  `docs/guides/new-service.md`

First deploy, pilot and operating steps: [gitai-service runbook](../../docs/runbooks/gitai-service.md).
