# observability-deploy

## What it is

The identity and throwaway resources the **Deploy Observability** workflow uses
to build, smoke-boot and roll out the observability host
(`infra/stacks/observability`). Prod-only, us-east-2, deployed by hand. It is a
separate stack so the workflow, which deploys the observability stack, can
never change its own permissions.

## Start here

- `policy.ts`: everything `macro-observability-deploy` may do, as data.
- `index.ts`: that role (GitHub OIDC, `main` only), the smoke host's role and
  instance profile, the `observability-smoke-*` buckets and the
  `observability/smoke` secret.
- `../observability/README.md`, "Deploying": what the workflow does with them.

## Scope

- Owns: the deploy role, smoke-boot resources.
- Not here: the GitHub OIDC provider (`../observability/ci.ts`), the image bucket
  and `macro-observability-vmimport` role (created by hand), the host itself.

## Recipes

- Give the workflow a new AWS call: add it to `policy.ts`, scoped by tag or ARN;
  `bun test stacks/observability/deploy` checks every call the scripts make.

## Checks

- From `infra/`: `bun run check`, Biome on changed `.ts`.

## Gotchas

- Deliberately absent from `.github/services-config.json`. Never `pulumi up`
  without explicit permission; the workflow fails at "Assume the deploy role"
  until this stack exists.
- The `observability/smoke` secret holds throwaway values the workflow writes on
  every smoke boot. Never put a real credential in it; it is not a Doppler secret.
- The smoke host must never reach production storage, CloudWatch or SNS: Loki
  and Tempo compactors delete blocks, and alerts would page.

## Related

- Rules: `.agents/rules/infra/pulumi.md` · Docs: `docs/development/infrastructure.md`
