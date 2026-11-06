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

Run `cargo x zigbuild` after editing Rust (it reuses unchanged artifacts),
preserving the binary directory,
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
Local Wrangler workers get namespace-specific state volumes even where their
Compose definitions bind-mount the shared worktree.

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

## Record measurements

Use a disposable instance for destructive startup measurements. Run both
runtimes at the same commit with identical binaries and tracing settings.
`measure.py` appends timestamps, commit, host load and CPU/memory/I/O pressure
to every raw JSONL record. It fails when the timed command or an HTTP probe fails.

```sh
python3 tooling/local-kubernetes/measure.py \
  --output infra/local/generated/kubernetes/perf.jsonl \
  --runtime kube --instance kube-bench --label cold-start \
  -- just kube-local up kube-bench --slot 0
python3 tooling/local-kubernetes/measure.py \
  --output infra/local/generated/kubernetes/perf.jsonl \
  --runtime kube --instance kube-bench --label steady --sample-seconds 60
python3 tooling/local-kubernetes/measure.py \
  --output infra/local/generated/kubernetes/perf.jsonl \
  --runtime kube --instance kube-bench --label latency \
  --url "https://$(hostname):32443"
python3 tooling/local-kubernetes/summarize.py \
  infra/local/generated/kubernetes/perf.jsonl
```

The summary refuses mixed commits or fewer than three runs per runtime and
measurement. Gateway probes make 100 sequential requests per route. `/app/`
measures HTML transfer, not browser rendering: collect browser navigation timings
separately. Resource sampling uses kubelet working-set/cumulative CPU statistics
for the selected namespace, and Docker cache-adjusted memory/CPU statistics for
only the selected Compose project. Account separately for the host Vite process,
shared node overhead, shared images and read-only binaries in a final comparison.
State cache conditions explicitly: empty data, init snapshot, persisted volumes,
already-built images/binaries, browser cache. Never flush machine-wide caches.
