# Connect infrastructure

## Scope

Standalone Pulumi project `macro-connect` for Connect's own ECS service,
load balancer, Postgres database, grant KMS key, and runtime secret. It may
read the existing VPC and use the `macro.com` Route 53 zone, but must not
mutate shared security groups or import Macro's `infra/` packages.

The optional demo service has its own image, task, target group, and runtime
secret. It is created only when encrypted `demoCustomerKey` config is set.

## Configuration

`dev` has the public host `connect-dev.macro.com`. Each stack requires
`vpcId`, `publicSubnetIds`, and `privateSubnetIds` config from the existing
VPC. `prod` also requires `publicHost`; choose it before previewing prod.
Live `own_app` credentials go in encrypted `ownAppCredentials` config as an
object keyed by app id, with `clientId` and `clientSecret` per entry.

## Checks

- `bun install --frozen-lockfile`
- `bunx tsc --noEmit`
- `bunx biome check .`

No agent deploys this stack without explicit human authorization.
