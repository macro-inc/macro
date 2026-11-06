# Macro Cloud Infra

Pulumi (TypeScript, Bun) for all of Macro's AWS infrastructure. Production is in
`us-east-1`; the [observability pilot](stacks/observability/README.md) runs
independently in `us-east-2`.

Each directory under `stacks/` is one Pulumi project with `dev` and `prod` stacks;
shared components live in `packages/`.

Read the [infrastructure guide](../docs/development/infrastructure.md) before
changing anything here, and the [new service guide](../docs/guides/new-service.md)
before adding a stack. Deploys run from CI; see the guide's deploy section.
