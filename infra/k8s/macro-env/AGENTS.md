# macro-env chart

## What it is

The Helm chart for one complete Macro environment in one namespace. It covers
the infra, services, workers, proxy, and static frontend. `cargo x env up`
installs it on a local kind cluster or on the EKS environments cluster. See
[Kubernetes environments](../../../docs/development/environments.md).

## How it works

The chart is generic. It turns `workloads` into Deployments, Services, PVCs,
and ConfigMaps, and adds one Ingress to the `proxy` workload. It knows nothing
Macro-specific. `xtask_local`'s `k8s/render.rs` generates the workloads from
the resolved local compose project.

## Start here

- `values.yaml`: the workload schema.
- `templates/workloads.yaml`: everything a workload renders to.
- `tooling/xtask/crates/xtask_local/src/local/k8s/render.rs`: the
  compose → values translation.

## Recipes

- Change what an environment runs: change the local stack (the inventory,
  `docker/docker-compose*.yml`, `local_env.rs`), not this chart.
- Add a Kubernetes-only field: add it to `values.yaml` and the template, then
  emit it from `render.rs`.

## Checks

- `helm lint infra/k8s/macro-env`
- `cargo test -p xtask_local --features local-stack k8s`

## Gotchas

- `onlyInfra=true` renders only `infra: true` workloads. Helm deletes the
  others, so `env up` uses it only for a brand-new release.
- The env Secret (`envSecret`) is applied outside the chart. `envDigest` rolls
  the pods when it changes.
