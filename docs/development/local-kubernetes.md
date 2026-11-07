# Local Kubernetes

`infra/k8s/` declares a complete local Macro stack in Nix. nixidy validates and
renders plain Kubernetes YAML; nix2container builds the images. A local registry
supplies the single kind node, sharing unchanged image layers across instances.
This is a parallel development path; Compose, `docker/` and `run_local` keep
their existing roles.

## Run two instances

From the Nix development shell, build host binaries once, then start each slot:

```sh
cargo x zigbuild
just kube-local up dev-a --slot 0 &
just kube-local up dev-b --slot 1 &
wait
just kube-local status dev-a
```

The command prints each HTTPS origin. Slots use ports 32443 and 32444 on the
machine hostname, signed by the existing local development CA. Trust that CA
as described in [running locally](running-locally.md). Use separate browser
profiles for independent sessions because cookies are shared across ports.

Doppler supplies the same local configuration as `run_local` by default.
`--env-file /private/path` overlays it; `--no-doppler` opts out. Agent sessions
need real model credentials. An offline stack can start without them but cannot
provide a real model reply.
Gmail forwarding starts when its provider key is present; the rendered reference
and image commands include its declaration in the complete service catalog.

Each instance owns its namespace, backing services, runtime Secrets and
persistent volumes. The controller verifies checkout ownership before changing
an existing namespace, cluster network or registry. It always uses its private
kubeconfig and an explicit context.

## Declarations and initialization

The host controller creates the namespace and runtime Secrets, applies the
Nix-rendered resources with server-side apply and ApplySet pruning, and waits.
There are no host port-forwards or service initialization scripts in the runner.
Private instance flakes render the declarations. A realized-output cache keys
repeat starts by commit, tracked diff, instance parameters and Nix version.
Nix validates the cached store output; source or configuration changes render
the declarations again. Cache metadata contains no credentials.

Postgres migrations, Kafka topics and OpenSearch indices run as Jobs. Init
containers wait for dependencies. LocalStack's ready.d script provisions the
existing shared AWS resource catalog; FusionAuth consumes its kickstart Secret.
Application pods wait for the initialization Jobs, while independent backing
services start in parallel.

Nix builds a pre-migrated Postgres seed without live credentials. A fresh volume
copies it and sets its password from a runtime Secret before serving traffic.
Existing volumes keep their data; the migration Job reconciles their schema.
Use `--no-seed` to exercise initialization without the seed.

Passwords, provider keys, kickstart contents and TLS private keys enter
Kubernetes Secrets only at startup. Deployments use `envFrom` or `secretKeyRef`;
Nix receives only a revision hash. Private state lives outside the checkout.
No runtime Secret is rendered or committed.

## Iterate and inspect

```sh
just kube-local roll dev-a --service unfurl-service
just kube-local roll dev-a --service unfurl-service --no-build
just kube-local logs dev-a --service agent-harness-service
just kube-local stop dev-a
just kube-local up dev-a --slot 0
just kube-local down dev-a
```

The development overlay mounts the host zigbuild output into a nix2container
base image. Rolling one service rebuilds binaries and restarts only the named
Deployment. `--no-build` performs only the restart. This path skips Nix image
builds and registry pushes. The other namespace continues running.

`stop` scales Deployments to zero and retains data. `down` removes declared
workloads while retaining the namespace, Secrets and PVCs. Removing persistent
data is an explicit separate operation; never delete another session's data.
PVC declarations are applied separately from the pruned workload set, so a
removed service declaration cannot silently remove its retained data.

## Full images and reviewable manifests

```sh
just kube-local images dev-a --full-images
just kube-local images dev-a --full-images --service unfurl-service
just kube-local up dev-a --slot 0 --full-images
just kube-local render
just kube-local render --check
```

The full image path bakes existing Nix service packages into images and pushes
only missing layers. It is separate from the host-binary development loop.
`infra/k8s/rendered/` contains one reference instance's plain YAML. Rendering is
deterministic; the check fails on drift, any rendered Secret, literal
credential environment variables or recognizable credential payloads.

Service declarations separate image registry, resources/replicas, runtime
Secret references and ingress. A later EKS overlay can change those inputs
without replacing service definitions or introducing a GitOps controller.

## Troubleshooting

Inspect failed Jobs and init-container logs before restarting applications.
MCP hosts must use Kubernetes' hyphenated service names; the harness accepts
exact hosts from its configured service and public URLs. DSS debug binaries
need `RUST_MIN_STACK=16777216`, provided by the dev overlay. The kind node is
pinned because newer cAdvisor versions fail to read this host's ZFS statistics.
The node declares `maxPods: 250` to fit two complete instances and rollout
surges; `Too many pods` means that kubelet setting needs checking.
Keep backing-service major versions compatible with existing volumes. Postgres
repairs indexes affected by a libc locale-version change before accepting
network connections; this preserves existing data when adopting older images.

For the operational workflow, see the
[kube-local skill](../../.agents/skills/kube-local/SKILL.md).
Performance results and methodology belong in the pull request description,
not in repository measurement scripts or committed result tables.

LGTM is declared per instance by default, with its Grafana UI at `/traces/`.
Use `up ... --no-telemetry` to disable the collector and telemetry export;
compare that configuration with Compose `--traces off`. Alternative collector
profiles and the shared browser remain separate opt-in tooling.
