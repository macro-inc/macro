# environments-cluster stack

## What it is

The dev-only EKS cluster that runs full Macro environments for demos, one
namespace each, installed by `cargo x env up <name> --target eks`. See
[Kubernetes environments](../../../docs/development/environments.md).

## Scope

- Owns:
  - the cluster and node group;
  - the EBS CSI driver and the `gp3` StorageClass;
  - Traefik behind an internet-facing NLB that terminates TLS with ACM;
  - the `*.<domain>` record;
  - the `macro-env` ECR repository;
  - the developer access role.
- Not here: what runs in an environment → `infra/k8s/macro-env` and
  `xtask_local`'s `k8s` module.

## Checks

- `bun run --cwd infra check` and Biome.
- `pulumi preview -s macro-inc/dev` from this directory.

## Gotchas

- Deployed manually and deliberately absent from `services-config.json`. Only
  a `dev` stack exists.
- Keep the Traefik chart version in step with `TRAEFIK_VERSION` in
  `xtask_local/src/local/k8s/cluster.rs`, so kind and EKS run the same
  ingress.
- The domain must stay outside `macro.com`. Environments run unreviewed
  branches and must not share the product's cookie domain.
- `cargo x env` names the developer role `macro-environments-developer-dev`.
  Renaming it breaks `--target eks`.
