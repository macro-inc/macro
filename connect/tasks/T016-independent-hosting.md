# T016: Host Connect as an independent backend

Base: `eric/macro-connect` (PR #9231).

## Goal

Connect deploys and runs on its own, touching none of Macro's deployed
services: its own Pulumi project under `connect/infra`, its own ECS cluster,
load balancer, database, KMS key, and secrets, reachable at
`https://connect-dev.macro.com`. It also runs locally with one command, so
integration tests can target either.

## Context

- Eric's direction (2026-10-30): the first pass is an entirely independent
  backend for integration tests, not wired to Macro. The PR already reverted
  everything that touched Macro's gateway, shared infra, deploy pipeline,
  service URLs, Doppler projects stack, and local stack.
- Prior art to mine (do not depend on it): the removed
  `infra/stacks/connect-api` (`git show 316f1e839f -- infra/stacks/connect-api`),
  `infra/stacks/preview-gateway` (builds its own image in Pulumi), Macro's
  `infra/packages/*` helpers. Copy what you need into `connect/infra`.
- `connect/docs/runbooks/bootstrap.md` (rewrite it), `connect/AGENTS.md`
  Boundary.
- Existing AWS (read-only lookups are fine): VPC used by Macro's services
  (look it up by id or tag from Pulumi config; put no resources into shared
  security groups), Route 53 zone `macro.com` (`Z0766278GIHB3CVV9CIL`).

## Do

1. **`connect/infra/`**: a standalone Pulumi TypeScript project
   (`macro-connect`, stacks `dev`, `prod`) with its own `package.json`,
   `tsconfig.json`, Biome config, and lockfile; no imports from Macro's
   `infra/` (the TS self-contained ast-grep rule: add `infra/` to its banned
   relative paths). Resources, all tagged `project: macro-connect`:
   - ECR repository and the `connect_api` image built in Pulumi from
     `connect/services/connect_api/Dockerfile` (multi-stage, repo root as
     context, small runtime image).
   - Its own ECS cluster, Fargate task and service (1 task in dev), CloudWatch
     log group, task role with only what Connect needs.
   - Its own internet-facing ALB, ACM certificate (DNS-validated), and an
     A/alias record `connect-dev.macro.com` (dev) in the `macro.com` zone;
     HTTPS only (HTTP redirects). Health check `/health`.
   - RDS PostgreSQL 17 `db.t4g.micro` (dev), private subnets, encrypted,
     backups, reachable only from the task's security group; prod settings
     as T013 had them (`db.t4g.small`, deletion protection, `protect`).
   - KMS key for grants (rotation on; only the task role may use it).
   - An AWS Secrets Manager secret holding the service's `APP_SECRETS_JSON`
     (`DATABASE_URL`, `CONNECT_KMS_KEY_ID`, `CONNECT_PUBLIC_URL`, and own-app
     credentials from encrypted Pulumi config when an `own_app` app is live),
     injected into the task. Connect's runtime uses no Doppler.
2. **Service paths.** At its own host Connect serves at the root; keep the
   `/connect` alias only if removing it costs more than it saves, and say
   which.
3. **Remove Doppler from the runtime:** delete the `connect_api_doppler_config`
   binary and Doppler mentions in `connect_api` code and docs. Doppler project
   `connect` keeps only operations secrets (the `connect@macro.com` account).
4. **Local run:** `connect/docker-compose.yml` with PostgreSQL 17 and
   `connect_api` (local wrapping key, `CONNECT_PUBLIC_URL=http://localhost:<port>`),
   and a documented one-liner to start it and create a customer.
5. **Docs:** rewrite `connect/docs/runbooks/bootstrap.md` (prerequisites:
   `PULUMI_ACCESS_TOKEN` and AWS credentials; `pulumi preview` then
   `pulumi up` from `connect/infra` on stack `dev`, each approved by the
   human; post-deploy check `curl https://connect-dev.macro.com/health`);
   `connect/infra/AGENTS.md` (+ `CLAUDE.md` symlink); update `connect/AGENTS.md`
   map, `connect/docs/catalog.md` (own-app credentials now live in Pulumi
   encrypted config), and `connect_api`'s `AGENTS.md`.

## Done when

- `cd connect/infra && bun install && bunx tsc --noEmit` and Biome pass.
- `docker compose -f connect/docker-compose.yml up` serves `/health` and
  `/v1/catalog` locally (paste the catalog's app ids).
- The Dockerfile builds (`docker build -f connect/services/connect_api/Dockerfile .`).
- `cargo nextest run --all-features -p connect_api -p connect_platform -p connect_registry`,
  clippy (`-D warnings`), `cargo x deps --check`, `just check` pass.
- `git diff origin/main --stat -- . ':!connect'` shows nothing beyond the PR's
  existing CI/tooling changes and the ast-grep rule edit.

## Out of scope

Running `pulumi` against AWS; any change to Macro's infra, gateway, deploy
workflows, or services; integration tests (T017).

## Result

### Changed

- `connect/infra/{Pulumi.yaml,Pulumi.dev.yaml,Pulumi.prod.yaml,index.ts,package.json,bun.lock,tsconfig.json,biome.json,AGENTS.md,CLAUDE.md}`: standalone `macro-connect` Pulumi project with its own ECR image, ECS cluster and service, IAM roles, log group, public ALB, DNS-validated certificate, alias record, private PostgreSQL 17 RDS, grant KMS key, and Secrets Manager runtime JSON. It reads the existing VPC id and subnet ids from stack config but creates its own security groups. Secret version changes create a new task definition and service rollout. Prod RDS has the T013 instance class, backups, deletion protection, and Pulumi protection. The TS boundary rule now bans relative imports from Macro's `infra/`.
- `connect/services/connect_api/{Dockerfile,Cargo.toml,src/main.rs,src/test.rs,src/oauth_test.rs,AGENTS.md}`: multi-stage container build, host-root routes and public URL, and updated route tests. Deleted `src/doppler_config.rs` and `src/doppler_config_test.rs`; removed that binary and its dependency. The `/connect` alias was removed because it required only a small router change. `Cargo.lock` was regenerated for the removed dependency.
- `connect/docker-compose.yml`: PostgreSQL 17 and the API with a local wrapping key, configurable host port, and localhost public URL.
- `connect/AGENTS.md` and `connect/docs/{runbooks/bootstrap.md,catalog.md,decisions.md,plan.md,submissions.md}`: standalone deploy and local bootstrap instructions, updated runtime credential source, and the superseding hosting decision. `connect/STATUS.md` was not changed.
- `rules/ast-grep/{ts-connect-self-contained.yml,tsx-connect-self-contained.yml}`: reject relative imports from Macro's `infra/`.

### Checks

All Rust, Bun, Docker, and repository tooling below ran inside `nix develop --command` with `CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR"` and `DATABASE_URL="$CONNECT_DATABASE_URL"` exported. `SQLX_OFFLINE` was unset for tests. No AWS Pulumi preview, deploy, production access, or secret read was run.

| Check | Exact outcome |
| --- | --- |
| `cd connect/infra && bun install --frozen-lockfile` | Passed; 262 installs checked across 252 packages, no changes. |
| `cd connect/infra && bunx tsc --noEmit` | Passed, exit 0. |
| `cd connect/infra && bunx biome check .` | Passed; 4 files checked, no fixes. |
| `docker build -t connect-api-t016 -f connect/services/connect_api/Dockerfile .` | Passed; release image built, exit 0. |
| `docker compose -f connect/docker-compose.yml up -d --build` | Initial run built the image but could not bind host port 8080 because it was in use. After making the host port configurable, `CONNECT_PORT=18080 docker compose -f connect/docker-compose.yml up -d` passed. `docker compose ... down` passed without removing the database volume. |
| Local HTTP and customer CLI | `/health` returned HTTP 200; `/v1/catalog` returned HTTP 200 with app ids `linear`, `notion`, `posthog`, `sentry`. `create-customer local --redirect-origin http://localhost:3000` exited 0 with its key output discarded. |
| `docker compose -f connect/docker-compose.yml config -q` | Passed with `CONNECT_PORT=18080`, exit 0. |
| `cargo nextest run --all-features -p connect_api -p connect_platform -p connect_registry` | Passed; 34 tests, 0 skipped. |
| `cargo clippy -p connect_api -p connect_platform -p connect_registry --all-features --all-targets -- -D warnings` | Passed, exit 0. |
| `cargo x deps --check` | Passed, exit 0. |
| `cargo fmt --all -- --check` | Passed, exit 0. |
| `just check` | Passed; format, ast-grep, PII scan, and scanner tests (`OK`). |
| `git diff --check` | Passed, exit 0. |
| `git diff origin/main --stat -- . ':!connect'` | Ran. It shows 182 files changed because this branch already differs broadly from current `origin/main`; this task adds only `Cargo.lock`'s required `doppler-config` removal and the two ast-grep rule edits outside `connect/` (verified with `git diff --name-only HEAD -- . ':!connect'`). The literal clean-stat criterion cannot be met without changing the pre-existing branch history. |
| Audit skill | Passed static review of resource isolation, secret rollout, host-root routing, symlink, and scoped changes. |

The hexagonal boundary was checked: the router change is transport composition; customer authorization and business policy remain in the existing domain service, and database/KMS work remains in outbound adapters.

### Open question

- Which public hostname should the production stack use? `Pulumi.prod.yaml` leaves `publicHost` unset, and production preview fails until that product decision is supplied.

### Proposed commits

1. `feat(connect-infra): provision an independent backend`

   Why: Integration tests need a separately deployable backend without shared application infrastructure.

   What: Add standalone Pulumi resources, encrypted runtime config, and the TypeScript boundary rule update.

2. `feat(connect-api): serve root routes and run locally with Compose`

   Why: The independent host and local stack need the same API paths and runtime configuration.

   What: Remove the gateway alias and Doppler validator, add the Dockerfile and Compose stack, and update route tests and Cargo artifacts.

3. `docs(connect): document standalone bootstrap`

   Why: The previous runbook described a shared deployment path that is no longer used.

   What: Replace bootstrap steps and update the catalog, decision, plan, submission, and agent guides.
