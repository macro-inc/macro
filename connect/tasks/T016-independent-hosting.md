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
