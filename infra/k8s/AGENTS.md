# Local Kubernetes platform

## What it is

A parallel, fully declared local Macro stack: Nix packages become nix2container
images, nixidy renders plain Kubernetes YAML, and `cargo x kube-local` applies it.
Compose and `run_local` remain independent.

## Start here

- `default.nix` composes instance overlays, typed resources and rendered YAML.
- `components/` declares the complete stack, local LGTM and all in-cluster initialization.
- `lib.nix` reuses the image and workload builders from the platform design.
- The controller is `tooling/xtask/crates/xtask_local/src/local/kubernetes/`.

## Scope

- Owns: local kind cluster, local registry, per-instance namespaces, manifests.
- Shared inputs: existing service packages, local environment, AWS resource and
  Kafka topic catalogs, database migrations and search mappings.
- Later EKS overlays change registry, resources/replicas, secrets and ingress.

## Checks

- `cargo test -p xtask_local --features local-stack kubernetes`
- `just kube-local render --check` checks committed YAML drift and credentials.
- After changing workloads, start two isolated instances and verify login,
  document creation and a real agent reply through their HTTPS origins.

## Gotchas

- Keep Secret values out of Nix arguments, derivations and rendered manifests;
  only the runtime Secret revision hash may enter Nix.
- Gate bootstrap Jobs on the dependency Deployment rollout before testing TCP;
  an old pod can still accept connections while its replacement is starting.
- Keep all initialization in Jobs, ready.d hooks or init containers. The host
  controller must never provision services or forward their ports.
- Preserve existing PVC names and the `app` Deployment selector when adopting
  the earlier local instances. Never delete their data during measurements.
- Apply PVCs outside the pruned workload set so removing a declaration retains data.
- Keep the dev roll path on host binaries; use images for the full image path.
- Keep the local OpenSearch JVM processor count small; host CPU counts inflate startup pools.
- Read the [kube-local skill](../../.agents/skills/kube-local/SKILL.md) for operation.
