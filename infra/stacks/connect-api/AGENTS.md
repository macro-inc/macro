# connect-api stack

## What it is

The ECS service, `/connect` gateway route, alarms, grant-envelope KMS key, private PostgreSQL instance, and Pulumi-owned Doppler runtime values for Macro Connect.

## Scope

- Owns: Connect task role, key, database, target group, service, scaling, and `DATABASE_URL`, `CONNECT_KMS_KEY_ID`, `CONNECT_PUBLIC_URL` in Doppler.

## Checks

- From `infra/`: `bunx tsc -p stacks/connect-api`
- From `infra/`: `bunx biome check stacks/connect-api`

## Gotchas

- Keep `bootstrap_pending` in `.github/services-config.json` until Eric approves the first deploy. Follow `connect/docs/runbooks/bootstrap.md` for order.
- The RDS-managed master password flows through a secret Pulumi output into Doppler; never export or log the URL. Only the ECS task role may encrypt/decrypt grants.
- Deploy the global `doppler-projects/prod` stack first. Before deploying this stack, set its own encrypted `doppler:dopplerToken` config using a service token scoped to `connect-api/dev` (or `connect-api/prd` for prod).
