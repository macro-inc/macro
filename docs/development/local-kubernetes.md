# Local Kubernetes

`just kube-local` runs the local service inventory on a single kind node, with
one namespace per instance. Nix declares kind, kubectl, the node image, network
ranges and HTTPS port mappings. It uses no cloud cluster or deployment tool.

## Run

Enter `nix develop` from the repository root. Keep temporary build files on the
home filesystem on small-root hosts: `export TMPDIR=/home/wolf/tmp`.

```sh
just kube-local up kube-a --slot 0
just kube-local up kube-b --slot 1
```

The first run builds the same Rust binaries, auxiliary images and frontend as
the Compose launcher. To use Nix-built binaries for both runtimes:

```sh
nix build .#local-stack-binaries --out-link infra/local/generated/kubernetes/binaries
just kube-local up kube-a --slot 0 --binaries-dir infra/local/generated/kubernetes/binaries
just kube-local up kube-b --slot 1 --binaries-dir infra/local/generated/kubernetes/binaries
```

The two HTTPS slots are `https://<hostname>:32443/app/` and
`https://<hostname>:32444/app/`. Trust the existing
[development CA](../../infra/local/certs/README.md). The hostname must resolve
and the ports must be reachable from the visiting machine. Passwordless codes
stay in each instance's `/mailpit/` UI at the same origin.

This runner uses `--no-doppler --traces off`. External integrations have the same
stub limitations as credential-free Compose. It does not create cloud tunnels.

## Inner loop and lifecycle

Rebuild a service with the normal host build, preserving its binary directory,
then roll just its Deployment. For a new Nix output, pass its binary directory
so the one Deployment adopts the new content-addressed path:

```sh
just kube-local roll kube-a --service unfurl_service
# After rebuilding a Nix binary set:
just kube-local roll kube-a --service unfurl_service --binaries-dir ./result
just kube-local status kube-a
just kube-local stop kube-a
just kube-local up kube-a --slot 0
just kube-local down kube-a
```

`stop` preserves PVCs; the next `up` resumes the instance. `down` deletes only
that namespace and its data. A fresh `up` initializes clean databases, Kafka
topics, local AWS resources, auth and search indices using the existing xtask
initialization functions. Initialization uses temporary loopback port forwards;
run initial bring-ups sequentially. Subsequent instances share the node but have
independent databases, local AWS emulators, volumes and service discovery.

The node mounts this worktree and the Nix store. Binaries and source mounts
remain identical to Compose. Auxiliary images are loaded into kind's containerd.
Compose underscore service hostnames become hyphens for Kubernetes DNS.
Application Deployments use rolling updates; single-replica backing stores use
Recreate and persistent claims. This is a development adapter, not an EKS stack.
The existing deployed ECS runtime and its AWS backing services are unchanged.

## Host compatibility

Kubernetes 1.35.5 is pinned because the 1.36 kubelet cannot obtain filesystem
statistics on this ZFS-backed Docker host. See the
[cAdvisor regression](https://github.com/google/cadvisor/issues/3904) and
[kind image digests](https://github.com/kubernetes-sigs/kind/releases/tag/v0.32.0).
The dedicated Docker subnet is `10.252.250.0/24`; creation fails on an overlap.
The runner never prunes networks, resets Docker, or uses the default kubeconfig.

## Validation status

The runtime and performance comparison are under active verification. Do not
interpret the fixed HTTPS slots as verified live links until the full login and
document-creation checks pass. Benchmark results will record the tested commit,
raw runs, host load, cache definitions and medians of at least three runs.
