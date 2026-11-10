---
name: kube-local
description: Run, debug, rebuild or render the parallel Nix-declared local Kubernetes Macro stack. Use for kind instances and kube-local commands; keep Compose and run_local workflows independent.
---

Read [the platform guide](../../../infra/k8s/AGENTS.md) and
[local Kubernetes](../../../docs/development/local-kubernetes.md).

Operate only this checkout's cluster, registry and namespaces. Ownership checks
are mandatory; never stop another session's processes, stacks or ports. Do not
use cloud deployment commands.

Bring up the full stack with `just kube-local up <name> --slot 0`. Doppler's local
configuration supplies model/integration credentials by default. Use
`--no-doppler` only when intentionally running without integrations; an env
file can supply them with `--env-file /private/path`. Never print credentials.
The controller creates Kubernetes Secrets through stdin; rendered manifests
reference them. Never copy Secret values into YAML, Nix expressions or the repo.

Build native Linux binaries with `cargo x build-services`. The development
overlay mounts `target/debug` and the host’s `/nix/store` read-only. Rebuild
old zigbuild output for this native contract; custom directories require
`up --binaries-dir /path` and `roll --no-build`.

Run two instances with different names and slots 0 and 1. The HTTPS links appear
at startup and in `just kube-local status <name>`. Each namespace has its own
backing services, PVCs and Secrets. Hostname cookies are shared across ports:
use separate browser profiles to test simultaneous logins.

- Stop while preserving data: `just kube-local stop <name>`.
- Restore: repeat the original `up` command with the same slot.
- Remove workloads while preserving data: `just kube-local down <name>`.
- Build host binaries and roll one service: `just kube-local roll <name> --service unfurl-service`.
- Restart an already-built binary: add `--no-build`; this skips Nix and the registry.
- Build and push complete images: `just kube-local images <name> --full-images`.
- Render reference YAML: `just kube-local render`.
- Check drift and credentials: `just kube-local render --check`.
- Follow logs: `just kube-local logs <name> --service agent-harness-service`.

Initialization runs in cluster. Diagnose incomplete Jobs and init containers
before restarting app pods. LocalStack ready.d uses the shared AWS catalog;
Kafka topics and search mappings retain their existing canonical sources.

Common failures:

- First-message model router panic: verify Doppler was used and the runtime
  Secret has the required key names. Inspect names only, never values.
- MCP DNS-rebinding rejection: configured MCP service/public URLs must name the
  hyphenated Kubernetes service hostname; exact configured hosts are allowed.
- DSS debug stack overflow: the dev overlay sets `RUST_MIN_STACK=16777216`.
- Blank documents or sync timeouts: `OVERRIDE_SYNC_SERVICE_URL` must resolve to
  `http://sync-service:8787` in the namespace; host localhost cannot initialize snapshots.
- Collector DNS errors: set `OTEL_EXPORTER_OTLP_ENDPOINT` only for a reachable
  collector; the local worker overlay disables the inherited default otherwise.
- ZFS node statistics: keep the pinned kind node version until the kubelet /
  cAdvisor regression is resolved; changing the kubectl version alone cannot fix it.
- Pending pods with `Too many pods`: the single node declares `maxPods: 250`
  for two complete instances and rollout surges; preserve that kubelet setting.
- Data upgrades: preserve PostgreSQL/OpenSearch/Kafka major versions and PVCs.
- No frontend: inspect the proxy logs and image; the frontend is prebuilt into
  the image and requires no frontend process or host port-forward.

Never commit benchmark tooling or numbers. Record measured medians and phase
profiles in the PR description, with the commit and at least three runs.

LGTM is declared per instance by default, with its Grafana UI at `/traces/`.
Use `up ... --no-telemetry` to disable the collector and telemetry export;
compare that configuration with Compose `--traces off`. Alternative collector
profiles and the shared browser remain separate opt-in tooling.
