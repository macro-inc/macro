# Running Locally

**DISCLAIMER**: This is a work in progress and we only support running services against dev-assets at this time.

## Prerequisites

- sops
- Docker
- AWS
- SQLX
- Pulumi
- Bun
- Node
- sqlx-cli

## Local Setup

Export the **SOPS_KMS_ARN** (you can skip if you use nix-shell)

```bash
export SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93"
```

Run `just setup` to initialize your entire environment.

Local Docker resources are intentionally frozen to the `macro` Compose project. Multiple checkouts/worktrees share the same containers, volumes, networks, LocalStack, and FusionAuth instance. Do not run two local stacks at the same time.

## Running

### Backend

You can run the services via `just run_local`.

If you've updated the docker image after making changes to a service you'll need
to provide the `--build` flag in `just run_local` to trigger docker-compose to
update the containers.

By default we don't run **convert_service** or **search_processing_service**
locally as they are not needed by the frontend when using dev assets. 

### Frontend

You can run the following command to get the frontend running pointed to local 
services `cd js/app && bun i && just local`.

### Local E2E smoke test

After `just setup`, run:

```bash
just local-e2e
```

This starts the local stack using `docker-compose.local-e2e.yml` overrides so
services use local Postgres/LocalStack instead of shared dev assets, seeds
deterministic smoke-test data, launches the frontend with local services and
local bearer-token auth, and runs the Playwright smoke test.

The local E2E seed scenario is guarded in code: it requires `LOCAL_E2E_SEED=true`
and refuses any `DATABASE_URL` that is not the local Docker database
`postgres://user:...@(localhost|127.0.0.1|postgres):5432/macrodb`.

Shared fixture data lives under `rust/cloud-storage/seed_cli/seed`; local users
are in `local_e2e/users.json`, Playwright tests can read the same data via
`js/app/tests/e2e/fixtures/local-e2e-seed.ts`, and Rust tests can use
`local_e2e_test_support`. The Rust helper also rejects non-local service URLs
for mutating tests.

To run the ignored Rust integration tests against the same local stack:

```bash
just local-e2e-rust
```

To run both Rust integration tests and Playwright tests after one stack startup
and seed pass:

```bash
just local-e2e-all
```
