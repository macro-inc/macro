# Macro Cloud Infra

Pulumi (TypeScript, Bun) for all of Macro's AWS infrastructure. Production is in
`us-east-1`; the [observability pilot](stacks/observability/README.md) runs
independently in `us-east-2`.

Each directory under `stacks/` is one Pulumi project with `dev` and `prod` stacks;
shared components live in `packages/`. The observability EKS cluster is the one
exception, in Nix under `k8s/observability/`: its AWS layer is OpenTofu
([`aws`](k8s/observability/aws/README.md)), and its Kubernetes objects are
applied by Argo CD ([`cluster`](k8s/observability/cluster/README.md)).

Read the [infrastructure guide](../docs/development/infrastructure.md) before
changing anything here, and the [new service guide](../docs/guides/new-service.md)
before adding a stack. Deploys run from CI; see the guide's deploy section.
