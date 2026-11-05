# infra/platform

Status: migrating to the target in
[docs/design/kubernetes-platform.md](../../docs/design/kubernetes-platform.md)

## What it is

Macro on Kubernetes, declared in Nix. It covers the per-instance data plane,
services, and edge, plus what a cluster runs once: the ingress, Argo CD, and a
Gitea forge with CI runners. Nix builds OCI images (nix2container) and renders
manifests (nixidy); `cargo x platform` (in `xtask_local/src/local/platform.rs`
and `platform/gitops.rs`) pushes the images and commits the manifests to the
deploy repo, which Argo CD syncs.

## How it works

- `default.nix`: `instance { name, host, binaries, frontend, node, ... }`
  renders one namespace as a nixidy environment; `push` builds a script that
  pushes its images.
- `cluster.nix`: the cluster-wide environment. `traefik` is declared here; Argo
  CD and Gitea are upstream Helm charts with pinned hashes.
- `components.nix`: every workload. Service names and ports match the hosts
  in the code-defined env (`xtask_local` `local_env.rs`), so services need no
  platform-specific config.
- `lib.nix`: OCI images (`image`, `pushImages`), the workload → Deployment/
  Service/PVC translation with sync waves, and `wrapBinary` for host-built Cargo
  binaries.
- `packages.nix`: components nixpkgs lacks (RustFS, celld, ExtendDB,
  FusionAuth).
- `instances.nix`: size profiles, the only thing allowed to differ between
  environments. `parity/` enforces that.

## Start here

- `components.nix`, then `lib.nix` `workloadResources`.
- `tooling/xtask/crates/xtask_local/src/local/platform.rs`: what `up` and
  `dev` do around Nix (Secrets, host builds, publishing).

## Recipes

- Run an instance: `just platform up [name]`, then open
  `https://<name>.localhost:9443/app/`. Login codes are at `/mailpit/`.
- Change one service: `just platform dev <workload>` rebuilds only that
  binary and rolls only its pod.
- Run CI on this branch: `cargo x platform mirror`, then open
  `https://git.localhost:9443/platform/macro/actions`. Port a workflow by adding
  it to `xtask_workflows/src/workflows/forge.rs`; never add one that deploys.
- See what is deployed: `https://argocd.localhost:9443/` (user `admin`; password
  in `argocd-initial-admin-secret`). The forge login is in `forge/forge-admin`.
- Build the self-host chart: `cargo x platform chart --release`, then `helm install`.
  It needs the `macro-env` and `fusionauth-kickstart` Secrets first (see its README).
- Add a workload: add it to `components.nix`, using a Service name that matches
  what `local_env.rs` dials. Mark data-plane pieces `infra = true` so they
  sync before provisioning (`wave` overrides the default).
- Change routes: edit the inventory or `proxy.rs`, then run
  `cargo x platform caddyfile`. `generated/Caddyfile` is checked in and
  tested.

## Checks

- `cargo test -p xtask_local --features local-stack platform`
- `cargo x workflows --check`, for `.gitea/workflows`.
- `python3 -m unittest` in `selfhost/`, `parity/`, `lambda-runner/`, and `push-sink/`.
- `nix build --no-link .#platform.parity`: local and prod differ only in size.
- `nix build --no-link .#platform.awsCheck`: the AWS configuration validates, offline
  and without credentials. Never apply it without explicit permission.
- Render an environment: `nix build --impure --expr '... f.platform.cluster.manifests'`
  (see `nix_build` in `platform.rs`). The flake reads only git-tracked files, so
  `git add` new files first.

## Gotchas

- Workloads that set `user` must use uid 1000, the only non-root account images
  ship in `/etc/passwd`.
- Each pod gets an emptyDir at `/tmp`. FusionAuth and OpenSearch write beside
  their install in the store, so they are redirected there.
- `/tmp` survives container restarts within a pod, so entrypoints must be
  idempotent.
- `macro_queues` local defaults are bare names, which LocalStack accepts and the
  queue gateway rejects. The instance env sets `OVERRIDE_LOCAL_QUEUE_BASE_URL`, and
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
- Argo CD waits on health before each sync wave, so an Ingress needs an address:
  Traefik publishes `127.0.0.1` for that. A resource stuck `Progressing` blocks
  every later wave.
- Editing a resource with `kubectl` does not stick: self-heal reverts it. Change
  the Nix and republish.
- The pool's free space counts as dataset size on ZFS, so kubelet percentage
  thresholds misfire on a shared pool. big-pickle sets absolute ones.
- CI jobs reach the forge at its in-cluster address (`http://gitea-http:3000`, the
  runner's instance URL), so they need no route to `git.localhost` or the dev CA.
- The forge's Docker MTU is below the overlay's: Docker's default of 1500 makes
  small requests work and large downloads hang.
- A copied store path keeps RUNPATHs to the original. On a Nix host the files are
  hardlinks and `ld.so` merges them; in an image they load twice. `fusionauthJdk`
  rewrites its RUNPATH for this reason.
- A StatefulSet with a crash-looping pod does not roll: delete the pod once after
  fixing the image (forge runners).
- RustFS reports a blocked private webhook target as `dns_failure`, while uploads
  still succeed. Add a new target's origin to `RUSTFS_OUTBOUND_ALLOW_ORIGINS`.
- Credentials are generated once per instance and recorded in its
  `platform-state.json`. Databases keep what they were first created with, so losing
  that state while keeping the volumes locks services out: `platform down` both.
