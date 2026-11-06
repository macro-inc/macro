# Local Kubernetes

`just kube-local` runs the local service inventory on a single kind node, with
one namespace per instance. Nix declares kind, kubectl, the node image, network
ranges and HTTPS port mappings. It uses no cloud cluster or deployment tool.

## Run

Enter `nix develop` from the repository root. Keep temporary build files on the
home filesystem on small-root hosts: `export TMPDIR="$HOME/tmp"`.

```sh
just kube-local up kube-a --slot 0
just kube-local up kube-b --slot 1
```

Doppler loads the same `local/lcl_personal` configuration as `just run_local`
by default, including model API keys for agent replies. Existing instances
refresh their generated environment and Deployments on `up`. Generated
credentials and manifests live in a mode-0700 directory outside the checkout;
ignored artifact paths inside the checkout are symlinks. No secret enters Git
or a Nix derivation. Deployments reference Kubernetes Secrets via `envFrom`;
only a content hash enters their Pod templates so rotating a key rolls the
affected pods. Secret data is applied server-side from stdin.

For offline smoke tests, pass `--no-doppler --env-file
tooling/local-kubernetes/local.env.example`. The example overlay registers
local Google-provider metadata required by the
agent harness at startup. Its placeholders support passwordless smoke tests;
they cannot authenticate Google accounts. Use your existing local integration
overlay for external integration tests. No production credentials are needed.

The first run builds the same Rust binaries, auxiliary images and frontend as
the Compose launcher. Existing auxiliary images are reused; pass
`--build-aux-services` when preparing a fresh instance after changing their
sources. Static builds run Vite under Node, with a 16 GiB heap ceiling. Pass
`--frontend-dir apps/web/dist` to reuse a prepared same-origin development bundle
across instances. Build it once with:

```sh
MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL \
VITE_LOCAL_BACKEND_ORIGIN=same-origin VITE_LOCAL_ONLY=true \
VITE_AI_EDITING_WORKER_URL=/ai-editing NODE_OPTIONS=--max-old-space-size=16384 \
bun run --cwd apps/web build
```

Set `MACRO_LOCAL_XTASK` to a previously built `xtask_local` executable to
reuse the launcher without invoking Cargo; otherwise the runner builds it
through Cargo.

Use `--binaries-dir target/x86_64-unknown-linux-gnu/debug` to reuse the
native binaries produced by `cargo x zigbuild`. The same flag accepts a prepared
Nix binary output. The measurements below used native debug binaries; they do
not validate the separate `local-stack-binaries` Nix build.

Native debug document storage needs the existing
[DSS-only worker stack override](running-locally.md#recover-an-existing-instance-without-resetting-data).
Apply it to each owned namespace after startup, outside tracked runtime files:

```sh
infra/local/generated/kubernetes/tools/bin/kubectl \
  --kubeconfig infra/local/generated/kubernetes/kubeconfig \
  --context kind-macro-eks-local -n macro-kube-kube-a \
  set env deployment/document-storage-service RUST_MIN_STACK=16777216
```

Wait for the Deployment rollout to complete, then repeat for
`macro-kube-kube-b`. This adjustment is already applied to the two
verified instances. `stop`, `up` and targeted rolls preserve it; a fresh namespace
needs it again.

The two HTTPS slots are `https://<hostname>:32443/app/` and
`https://<hostname>:32444/app/`. Trust the existing
[development CA](../../infra/local/certs/README.md). The hostname must resolve
and the ports must be reachable from the visiting machine. Passwordless codes
stay in each instance's `/mailpit/` UI at the same origin. Cookies are scoped to
the hostname, not the port; use separate browser profiles for simultaneous
sign-ins to the two instances.

This runner uses `--traces off`. Opt-in `--no-doppler` mode has the same
stub limitations as credential-free Compose, and cannot provide model replies. Pass `--env-file <path>` to apply
the same optional dotenv overlay as `run_local`. It does not create cloud tunnels.

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

Unchanged isolated worker binaries retain their modification times, so rebuilds
do not restart them. Changed binaries replace their executable inode atomically;
running processes continue until their targeted restart or roll.

`stop` preserves PVCs; the next `up` starts backing stores first, restores
LocalStack resources and then starts application pods. As in Compose, restoring
LocalStack resources does not recover objects lost from its ephemeral storage. `down` deletes only
that namespace and its data. A fresh `up` initializes clean databases, Kafka
topics, local AWS resources, auth and search indices using the existing xtask
initialization functions. Initialization uses temporary loopback port forwards;
run initial bring-ups sequentially. Subsequent instances share the node but have
independent databases, local AWS emulators, volumes and service discovery.
Local Wrangler workers get namespace-specific state volumes and pod-local
configuration files even where their Compose definitions bind-mount the shared
worktree.
FusionAuth starts only after its database is healthy; a partial-start retry
restarts FusionAuth after that dependency check to recover maintenance mode.

The node mounts this worktree, the Nix store and the local Docker sandbox socket.
Containers with unlimited Compose memlock receive the `IPC_LOCK` capability.
Binaries and source mounts
remain identical to Compose. Auxiliary images are loaded into kind's containerd.
Compose underscore service hostnames become hyphens for Kubernetes DNS in
environment values and normalized Caddy/Nginx configuration files.
Pods use DNS discovery with Service environment links disabled, avoiding injected
values such as `PROXY_PORT` that conflict with application configuration.
Application Deployments use rolling updates; single-replica backing stores use
Recreate and persistent claims. This is a development adapter, not an EKS stack.
Kafka publishes its service endpoints before readiness so its KRaft controller
can connect during bootstrap.
FusionAuth seeds image-default configuration into a fresh PVC, matching Docker's
named-volume initialization; later starts preserve that configuration.
The existing deployed ECS runtime and its AWS backing services are unchanged.

## Host compatibility

Kubernetes 1.35.5 is pinned because the 1.36 kubelet cannot obtain filesystem
statistics on this ZFS-backed Docker host. See the
[cAdvisor regression](https://github.com/google/cadvisor/issues/3904) and
[kind image digests](https://github.com/kubernetes-sigs/kind/releases/tag/v0.32.0).
The dedicated Docker subnet is `10.252.250.0/24`; creation fails on an overlap.
The runner never prunes networks, resets Docker, or uses the default kubeconfig.
Images are exported for the node's native platform before import, following
[kind's containerd image-store workaround](https://github.com/kubernetes-sigs/kind/blob/main/site/content/docs/user/known-issues.md#unable-to-kind-load-docker-images).

## Validation

Both restored namespaces have 31 ready pods. Fresh browser sessions in each
passed passwordless login using its actual Mailpit code, rendered the Mailpit
UI, created a document and retained its content after reload. Each namespace
returned 200 for its own document and 404 for the other namespace's document.
Both HTTPS origins passed CA verification through the host's tailnet address.
Both Nix tools and configuration derivations built successfully; the tools
resolve to the exact store binaries used by the running cluster. The
configuration output was compared with the running kind
configuration, differing only by the runner's checkout-specific mounts.

Python checks passed eight tests; the local xtask package passed 130 Rust tests
and scoped Clippy. Repository checks and commit privacy checks passed. No cloud
deployment or other session's runtime was changed.

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


## Measured comparison

Medians of three runs per cell (Compose teardown has five). Prepared artifacts,
one active instance, same application/runtime commit; definitions follow below.

| Measurement | Compose | Kubernetes |
| --- | ---: | ---: |
| Cold startup, empty data | 77.3 s | 130.7 s |
| Warm startup | 72.7 s | 55.1 s |
| One-service rebuild and roll/reload | 13.21 s | 13.06 s |
| Delete instance | 16.7 s | 49.3 s |
| Stop/teardown and restore | 89.8 s | 88.8 s |
| Whole runtime RAM | 6.99 GiB | 7.19 GiB |
| Whole runtime CPU | 0.722 cores | 1.433 cores |
| Instance writable disk, logs and volumes | 0.033 GiB | 0.062 GiB |
| Additional kind node disk total, including cache and all PVCs | — | 10.956 GiB |
| Rendered page p50 / p95 | 5513 / 6003 ms | 1117 / 1241 ms |

Whole Kubernetes resources include its shared control plane. Namespace alone
used 5.66 GiB RAM and 0.939 cores; shared overhead was about 1.54 GiB and an
estimated 0.500 cores. These one-instance totals do not predict exactly how two
instances share the node. The second instance was stopped during resource runs
and restored afterward. Browser loads succeeded in all 60 attempts per runtime.

| Gateway request, fresh TLS connection | Compose p50 / p95 | Kubernetes p50 / p95 |
| --- | ---: | ---: |
| `/auth/health` | 4.145 / 6.013 ms | 3.590 / 5.665 ms |
| `/connection-gateway/health` | 4.693 / 6.052 ms | 4.099 / 5.632 ms |
| `/contacts/health` | 4.549 / 5.780 ms | 3.917 / 5.581 ms |
| `/dss/health` | 4.903 / 5.844 ms | 4.272 / 6.291 ms |
| `/app/` HTML transfer | 8.514 / 16.441 ms | 3.482 / 4.380 ms |
| `/auth/user/me`, authenticated | 6.010 / 7.167 ms | 5.382 / 6.819 ms |

Warm resume is faster in this sample; fresh startup and deletion are slower.
Rebuild and full restore are effectively tied under the observed host load.
Kubernetes uses about twice the idle CPU after including the control plane, with
similar total RAM and an additional imported image cache. Default Kubernetes pod
termination grace is 30 seconds versus Docker's usual 10; explicit Compose stop
timeouts are preserved. The page result includes static bundling versus Vite,
so it does not establish a Kubernetes networking advantage.

## Comparison method

The comparison was collected on 2026-11-06 at runtime commit
`bfd01f8dc3` with 31 services, tracing off and the same native debug binaries,
auxiliary images and explicit offline integration overlay. Reporting changes
corrected CPU timestamp normalization and added the disk summary afterward;
application and orchestration code stayed fixed throughout the final runs.
Raw records are retained locally in
`infra/local/generated/kubernetes/perf.jsonl`, with host pressure and load for
every run. Every reported cell is the median of at least three runs.

The host has a Xeon 6985P-C, 144 logical CPUs and 283 GiB RAM. The build agent
has a 12-core/64-GiB limit; Docker containers share the host without a quota.
Native builds used four jobs and a task-owned build/cache directory on ZFS.
Other sessions stayed running. Runs were sequential rather than randomized;
host contention makes small timing differences inconclusive. The one-minute
load ranged from 60.47–89.31 during Compose runs and 56.67–129.27 during all
Kubernetes runs.

Cold means empty instance data with the node already ready and binaries,
images and frontend already built. It excludes first-time compilation, image
pulls and cluster creation. Warm Compose restores its initialization snapshot;
warm Kubernetes resumes PVCs. Both restore LocalStack resource definitions.
Both include the documented DSS-only debug stack workaround; fresh Kubernetes
startup includes an additional Deployment roll to apply it. These are measured
workflow costs, rather than a controlled comparison of scheduler startup alone.

The baseline used the literal `just run_local --instance compose-bench` recipe,
with `--port-base 32500 --no-doppler --traces off`, the same `--binaries-dir`
and `--env-file`, and a prebuilt xtask executable supplied through Just's
`xtask` variable. Cold runs add `--no-snapshot`. Its Vite watcher used polling
because the shared host had exhausted inotify watches. No global limits changed.

The rebuild measurement changes one trace string in `unfurl_service`, using
unique equal-length markers to avoid result-cache hits, then builds and waits
for the service to be ready: Compose's `r` hotkey versus a targeted Kubernetes
roll. Original source and binaries were restored afterward. Identity snapshots
confirm only that service changed; the other 30 stayed running.

Resources use three 60-second windows at five-second intervals, with only the
measured instance active. Compose includes Docker cache-adjusted memory/CPU and
its launcher/Vite processes. Kubernetes reports both namespace working set and
the whole node, including the control plane. CPU rates use each cumulative
metric's own timestamp; node-minus-pods CPU is only an overhead estimate because
metric intervals can have different endpoints. Docker daemon costs and common
read-only image/binary caches are excluded for both runtimes.

Instance disk counts writable layers, logs and named volumes/PVCs. The additional
whole-node disk total includes containerd's imported image cache, control-plane
state and all PVCs, including the stopped second namespace. Host-path PVC usage is
read separately with `du` because kubelet omits these volumes; the three PVC
snapshots followed the resource windows, with their own timestamps in the raw
records. Do not add namespace
PVC bytes to that total a second time. The kind base image is another 0.35 GiB
of logical read-only image data; neither figure is a physical ZFS allocation.

API samples are three batches of 100 sequential successful requests per route,
with a fresh curl TLS connection, the development CA and an authenticated cookie
jar for `/auth/user/me`. Page timings are three batches of 20 fresh authenticated
Chrome 153 contexts, from navigation until the app's Create control is visible,
with one second between samples outside the timer. The browser runs in the owned
kind network namespace to avoid unrelated host interface changes, and reaches
both runtimes through the host HTTPS ingress. Its cgroup stays outside kind, so
its resources are not charged to the server. A temporary INPUT rule allowed
only that owned client address to the two owned HTTPS ports; it is removed after
verification. Earlier host-network browser calibration attempts are archived
separately and excluded because the client protocol/environment differed.
These timings measure devbox access, not laptop network latency.

Kubernetes serves a prepared static development bundle; Compose serves Vite.
Any browser speed difference includes that serving-mode difference. Kubernetes
has no Vite frontend hot reload. ECS and deployed backing services are unchanged;
this adds a local adapter, without deploying or replacing cloud infrastructure.
