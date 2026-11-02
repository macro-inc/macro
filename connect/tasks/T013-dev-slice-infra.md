# T013: Pulumi owns all of Connect's infra; first-slice apps

Base on the integration branch (T006 and T012 merged).

## Goal

Deploying the `connect-api` stack to dev produces a working Connect with no
manual steps beyond running the deploys: its own database, its KMS key, and
its runtime config all come from Pulumi. Only the first-slice apps are live.

## Context

- `infra/stacks/connect-api/` and `connect/docs/runbooks/database.md` (T012).
- `docs/development/infrastructure.md`; `.agents/rules/config-and-service-urls.md`:
  in ECS the service reads only `APP_SECRETS_JSON`, so a value from infra must
  be written into Doppler. `infra/stacks/preview-gateway` writes Doppler
  values from Pulumi; follow it.
- `connect/docs/decisions.md`: Connect gets its own small RDS instance.
- `connect_api`'s config and `src/doppler_config.rs`; `connect_registry`.

## Do

1. **RDS.** In the `connect-api` stack: a PostgreSQL instance for Connect
   (dev `db.t4g.micro`, prod `db.t4g.small`; current major version; private
   subnets of the coparse VPC; encrypted; automated backups; `protect` and
   deletion protection in prod), a security group admitting only the service's
   task security group on 5432, and RDS-managed or Pulumi-generated
   credentials (never in code or logs).
2. **Doppler from Pulumi.** The stack writes `DATABASE_URL`,
   `CONNECT_KMS_KEY_ID`, and `CONNECT_PUBLIC_URL` (the gateway `/connect` URL;
   confirm the gateway strips `/connect` before forwarding, or make the
   service serve under it, and say which) into Doppler `connect-api/<env>` the
   way `preview-gateway` does.
3. **Bootstrap order.** Make the first deploy work in one pass, or document
   the exact order (for example: `doppler-projects`, then `connect-api`
   infra, then the service) in a rewritten `connect/docs/runbooks/database.md`
   renamed to `bootstrap.md`, with no manual database or Doppler steps. Keep
   `bootstrap_pending` set; removing it is the planner's change after the
   human runs the deploys.
4. **Own-app credentials only for live apps.** `connect_api` requires
   `<ID>_CLIENT_ID`/`_SECRET` only for `own_app` apps whose `status` is
   `live`; `doppler_config.rs` validates `CONNECT_PUBLIC_URL`, `DATABASE_URL`,
   `CONNECT_KMS_KEY_ID`, and the live own-app keys.
5. **First slice.** In `connect/registry/apps/`, set `status = "pending"` on
   every app except `linear`, `notion`, `posthog`, `sentry`.
6. Tests: config requires own-app keys only for live apps; the registry has
   exactly the four live apps; `doppler_config` key list.

## Done when

- `cargo nextest run --all-features -p connect_api -p connect_registry`
  passes; clippy (`-D warnings`), `cargo x deps --check`, `just check full`
  pass.
- `cd infra && bunx tsc -p stacks/connect-api` and infra Biome pass.
- The local stack still comes up and `/connect/health` answers through the
  local proxy (`--no-doppler` is fine).
- The Result lists the exact deploy commands/workflow dispatches, in order,
  for dev.

## Out of scope

Running any deploy or `pulumi` command against AWS; creating Doppler values by
hand; prod.

## Review (planner, 2026-10-30)

Use PostgreSQL 17 on `db.t4g.micro` (dev) and `db.t4g.small` (prod): AWS
documents both classes for 17, and Connect's queries need nothing from 18.
Finish the task and re-run every check; the Result must show final-revision
outcomes. Note that the `doppler-projects` deploy targets the global (prod)
stack: say so plainly in the deploy order, since the human approves each
deploy.

## Review 2 (planner, 2026-10-30)

Do not export the global Doppler token from `doppler-projects`: any stack
that references it could read a workplace-wide credential. Revert the
`doppler-projects` change. Follow `infra/stacks/preview-gateway`: the
`connect-api` stack's Doppler provider takes its own encrypted stack config
`doppler:dopplerToken` (in `Pulumi.dev.yaml` and `Pulumi.prod.yaml`, set by a
human with `pulumi config set --secret`), scoped to the `connect-api` project.
Add that one human step to `bootstrap.md`: create a Doppler service token with
write access to `connect-api` `dev` (and `prd` later) and set it as the
stack's secret config. Keep everything else. Re-run the infra checks.

## Result

### Changed

- infra/stacks/connect-api/index.ts uses this stack's encrypted doppler:dopplerToken config for its provider. infra/stacks/connect-api/service.ts creates private PostgreSQL 17 RDS (db.t4g.micro in dev, db.t4g.small in prod), a service-only database security group, managed credentials, and Pulumi-owned DATABASE_URL, CONNECT_KMS_KEY_ID, and CONNECT_PUBLIC_URL Doppler values. Prod RDS has deletion protection and Pulumi protect. Pulumi.dev.yaml and Pulumi.prod.yaml document where the human sets their scoped encrypted token; AGENTS.md describes the boundary. infra/stacks/doppler-projects/index.ts is unchanged and exports no token.
- The 32 changed connect/registry/apps/*/app.toml entries are pending; only Linear, Notion, PostHog, and Sentry remain live. connect/crates/connect_registry/src/test.rs asserts that exact set.
- connect/services/connect_api/src/{main.rs,domain/oauth.rs,doppler_config.rs,doppler_config_test.rs,test.rs,oauth_test.rs} and connect/crates/connect_platform/src/config.rs require credentials only for live own-app entries, validate the corresponding Doppler keys, and preserve the gateway /connect prefix in public OAuth and catalog URLs.
- connect/docs/runbooks/bootstrap.md replaces database.md with the deploy and encrypted token setup order. connect/docs/{catalog.md,decisions.md}, connect/services/connect_api/AGENTS.md, and this Result describe the first slice and bootstrap.

### Checks on final revision

| Check | Exact outcome |
| --- | --- |
| bunx tsc -p stacks/connect-api and bunx tsc -p stacks/doppler-projects from infra/ | Passed. |
| bunx biome check stacks/connect-api stacks/doppler-projects from infra/ | Passed; 5 files checked. |
| bun run lint from infra/ | Passed; Biome checked 228 files. |
| bun run check from infra/ | Passed; tsc --noEmit. |
| cargo nextest run --all-features -p connect_api -p connect_registry -p connect_platform | Passed; 29 tests, 0 skipped. |
| cargo clippy -p connect_api -p connect_registry -p connect_platform --all-features --all-targets -- -D warnings | Passed. |
| cargo x deps --check | Passed. |
| just check full | Passed; format, ast-grep, workspace clippy, full checks; OK. |
| just check | Passed separately; OK. |
| just doctor-local --instance t013 | Passed; Docker, tooling, and all 34 ports. |
| Isolated stack and /connect/health through local proxy | Passed. just stack up --instance t013 --no-doppler --no-frontend --binaries-dir "$CONNECT_CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/debug" reported ready. curl --fail --insecure https://localhost:21709/connect/health returned HTTP 200. just stop_local --instance t013 completed. |
| git diff --check HEAD | Passed. |
| Audit skill | Passed after this Result update; token boundary, runbook order, and diff hygiene verified. |

Cargo, Just, Bun, and curl checks ran inside nix develop --command with CARGO_TARGET_DIR="$CONNECT_CARGO_TARGET_DIR" and DATABASE_URL="$CONNECT_DATABASE_URL" exported. SQLX_OFFLINE was unset for tests. No deploy, AWS change, or manual Doppler write was run.

### Dev deploy order

1. Dispatch the global Doppler project stack and wait for success. Its prod Pulumi stack owns global Doppler projects; this is not a Connect production deploy.

       gh workflow run deploy-pulumi-stack.yml --ref <reviewed-ref> -f environment=prod -f pulumi-service-name=doppler-projects

2. The human creates a Doppler service token with write access limited to connect-api/dev. From infra/stacks/connect-api, the human writes it into this stack's encrypted dev config, then adds the encrypted Pulumi.dev.yaml update to the reviewed deploy ref. The plaintext token is never printed or committed. The production equivalent later uses a separate token scoped to connect-api/prd and Pulumi.prod.yaml.

       pulumi config set --stack dev --secret doppler:dopplerToken

3. Dispatch Connect infrastructure in dev from the ref containing the encrypted config, then wait for success.

       gh workflow run deploy-pulumi-stack.yml --ref <reviewed-ref-with-encrypted-config> -f environment=dev -f pulumi-service-name=connect-api

4. The planner removes bootstrap_pending in a reviewed change. Dispatch the Connect service workflow from that ref and wait for success.

       gh workflow run deploy-service-generic.yml --ref <reviewed-ref-with-gate-removed> -f environment=dev -f service=connect-api

5. Request https://dev-gateway.macro.com/connect/health and expect HTTP 200.

The live Doppler-to-Secrets-Manager sync and ECS health remain unverified until the approved dev deploy.

### Open questions

None.

### Proposed commits

- feat(connect): provision isolated Connect infrastructure

  Why: Connect needs its own database and reproducible runtime values for dev bootstrap.
  What: Create RDS and scoped Doppler resources, document encrypted stack token setup and deploy order.

- feat(connect): limit the live catalog to the first slice

  Why: Only four apps are ready for first-slice conformance.
  What: Mark other registry entries pending and assert the live set.

- fix(connect): load live app credentials and preserve gateway paths

  Why: Pending own-app credentials and /connect URL handling would block startup and OAuth.
  What: Derive required keys from live apps, validate Doppler config, and preserve the gateway prefix in public URLs.
