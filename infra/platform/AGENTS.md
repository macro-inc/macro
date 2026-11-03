# infra/platform

Status: migrating to the target in
[docs/design/kubernetes-platform.md](../../docs/design/kubernetes-platform.md)

## What it is

Macro on Kubernetes, declared in Nix. It covers the per-instance data plane,
services, edge, and ingress, and runs on k3s with the nix snapshotter, so
images are `nix:0/nix/store/...` references. `cargo x platform` (in
`xtask_local/src/local/platform.rs`) runs instances on the local cluster.

## How it works

- `default.nix`: `instance { name, host, binaries, frontend, node, ... }`
  renders one namespace with kubenix; `cluster` renders the ingress.
- `components.nix`: every workload. Service names and ports match the hosts
  in the code-defined env (`xtask_local` `local_env.rs`), so services need no
  platform-specific config.
- `lib.nix`: store-path images (`image`), the workload → Deployment/Service/
  PVC translation, and `wrapBinary` for host-built Cargo binaries.
- `packages.nix`: components nixpkgs lacks (RustFS, celld, ExtendDB,
  local-kms, FusionAuth).
- `instances.nix`: size profiles, the only thing allowed to differ between
  environments.

## Start here

- `components.nix`, then `lib.nix` `workloadResources`.
- `tooling/xtask/crates/xtask_local/src/local/platform.rs`: what `up` and
  `dev` do around Nix (Secrets, host builds, apply order, provisioning).

## Recipes

- Run an instance: `just platform up [name]`, then open
  `https://<name>.localhost:9443/app/`. Login codes are at `/mailpit/`.
- Change one service: `just platform dev <workload>` rebuilds only that
  binary and rolls only its pod.
- Add a workload: add it to `components.nix`, using a Service name that matches
  what `local_env.rs` dials. Mark data-plane pieces `infra = true` so they
  start before provisioning.
- Change routes: edit the inventory or `proxy.rs`, then run
  `cargo x platform caddyfile`. `generated/Caddyfile` is checked in and
  tested.

## Checks

- `cargo test -p xtask_local --features local-stack platform`
- Build every image:
  `nix build --impure --expr '... f.platform.instance { ... }'` (see `nix_build`
  in `platform.rs`). The flake reads only git-tracked files, so `git add` new
  files first.

## Gotchas

- Images cannot ship `/etc/passwd`: containerd refuses the store-path
  symlinks. `lib.nix` provides an account at runtime through `nss_wrapper`.
- Store-path roots are read-only. Each pod gets an emptyDir at `/tmp`, and
  anything that writes beside its install (FusionAuth, OpenSearch) is
  redirected there.
- `/tmp` survives container restarts within a pod, so entrypoints must be
  idempotent.
- `macro_queues` local defaults are bare names, which LocalStack accepts and
  ElasticMQ rejects. The instance env sets `OVERRIDE_LOCAL_QUEUE_BASE_URL`, and
  `queue_urls` in `platform.rs` expands the env's queue variables.
- Services publish not-ready addresses (compose DNS semantics). Kafka's
  controller dials itself through its Service before it is ready.
- The AWS gateway (`localstack:4566`) routes by signed service name, and the
  backends verify SigV4, including the Host header. Keep `Host` unchanged
  through every proxy.
- ExtendDB accepts only AWS-shaped keys. `platform up` generates one per
  instance, kept in `macro-env`; never commit one.
- Certificates name only their instance's host: the shared ingress picks by
  SNI, and a wildcard entry would serve one instance's certificate for another.
