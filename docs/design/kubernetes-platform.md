# Macro on Kubernetes, declared in Nix

Status: approved spec. Nothing in this document is implemented yet. The
earlier compose-to-Helm prototype on this branch is superseded (see
[What happens to the prototype](#what-happens-to-the-prototype)).

## Goals

1. **One platform everywhere.** Local, dev, and prod run the same Kubernetes
   distribution, the same manifests, and the same images. They differ only in
   instance sizes, replica counts, storage sizes, secrets, and hostnames.
2. **Many instances per cluster.** Any cluster runs any number of complete,
   isolated Macro instances (one per namespace), for demos, previews, and
   parallel development.
3. **Fast change to a running instance.** Replace one pod in seconds, never
   restart the whole stack. Target: edit → new pod serving in under 30 seconds
   for a Rust service, and under 5 seconds once the binary is built.
4. **Declared in Nix.** Cluster nodes, container images, Kubernetes manifests,
   and cloud infrastructure are Nix expressions. Dockerfiles, Helm values, and
   Pulumi go away.
5. **No provider lock-in.** Every AWS- or Cloudflare-specific dependency gets a
   free, open-source, permissively licensed replacement that runs as pods in
   the instance.
6. **Real service boundaries.** Split the large services into smaller pods and
   replace the ad hoc internal HTTP/queue IPC with typed, generated gRPC.
7. **Auxiliary services too.** CI runners and the Cloudflare bot workers run on
   the same clusters.

First pass: everything runs on one local machine (big-pickle), declared so that
the same expressions later deploy to AWS.

## Non-goals for the first pass

- Migrating production data. Prod keeps running on ECS until a separate cutover
  plan is approved.
- Replacing FusionAuth. It is already self-hostable and runs as a pod.
- Multi-region.

## Decisions

Each decision lists the evidence behind it. "Tested" means it was run on this
machine on 2026-11-03.

### Cluster: k3s on NixOS, everywhere

- **Local:** a NixOS module in the big-pickle flake enables `services.k3s`
  with the `nix` snapshotter. It runs beside the existing Docker daemon, with
  non-overlapping pod and service CIDRs and no host ports in Docker's ranges.
- **AWS:** NixOS EC2 instances running the same k3s module, three servers with
  embedded etcd plus an agent pool. They are provisioned by OpenTofu (from
  terranix) and configured with `nixos-anywhere` and `colmena`.
- **Why not EKS:** the image strategy below needs Nix on every node. EKS
  managed nodes don't have it, and a custom NixOS node joining EKS would break
  the "same distribution everywhere" goal. We accept running our own control
  plane in exchange for exact local/prod parity.
- **Evidence:** upstream k3s v1.35.4 ships the nix snapshotter built in
  (`--snapshotter nix`). Tested in an isolated container against the host
  store: the node became Ready, and a pod ran from a `nix:0/nix/store/...`
  image reference.

### Images: Nix store paths, not registries (nix-snapshotter)

This is the "shared Nix store across all pods" project:
[nix-snapshotter](https://github.com/pdtpartners/nix-snapshotter). An image is
a tiny manifest that names store paths, and the node bind-mounts those paths
from its own `/nix/store`.

- **Tested:**
  - pull 99 ms, image size 1,487 bytes;
  - a new build plus rollout of a running Deployment to the new image: 1.1 s
    `nix build` and 1.9 s to Ready.
- **Remote nodes** fetch missing paths from a binary cache, not a registry.
  The cache is Attic or a plain S3 binary cache, hosted on the cluster's own
  object store.
- **No Dockerfiles.** Each service is a Nix package plus a `buildImage` call.
  Third-party images (Postgres, Kafka, and so on) come from nixpkgs as well,
  so nodes pull nothing from Docker Hub.
- **Risk:** k3s issue #14393 reports `CreateContainer` failures for `nix:0`
  images in some k3s builds, and the snapshotter is community-supported in k3s.
  We pin a k3s version that passes our boot test. The fallback that keeps
  everything else intact is `nix2container`: OCI images pushed with skopeo to
  an in-cluster registry.

### Manifests: Nix modules (kubenix), rendered and applied per namespace

- Each service is one Nix module that emits its Kubernetes resources. Resource
  options are typed by [kubenix](https://github.com/hall/kubenix).
- An **instance** is `instances.<name> = { size = "local"; host = ...; }`. It
  renders into namespace `macro-<name>`.
- **Local and dev** apply rendered manifests directly with
  `kubectl apply --server-side --prune` (seconds, no GitOps loop in the inner
  path).
- **Prod** uses [nixidy](https://github.com/arnarg/nixidy): the same modules,
  rendered by CI, committed, and synced by Argo CD. Prod changes are reviewed
  as YAML diffs.
- **Parity check:** CI renders the `local` and `prod` instances and diffs
  them. The only allowed differences are replicas, resources, storage sizes,
  hostnames, and secret references. Any other difference fails the build.

### Infrastructure as code: terranix + OpenTofu, operators in-cluster

Pulumi's job splits in two:

1. **Outside the cluster:**
   - the VPC, EC2 nodes, and load balancer or Elastic IPs;
   - Route 53, and the S3 buckets for backups and the binary cache.

   These are written in Nix with terranix and applied by OpenTofu (MPL-2.0).
2. **Inside the cluster:** what Pulumi creates today per environment becomes
   declarations in the instance module:
   - queues, tables, buckets, topics, and the KMS key equivalents;
   - DNS records and certificates.

   Operators and small init Jobs reconcile them, so every instance gets them
   automatically.

The existing Pulumi stacks keep running prod until cutover. No stack is
destroyed as part of this work.

### Provider replacements

All of these run as pods inside each instance (per-namespace data plane).
Operators are installed once per cluster.

| Today | Replacement | License | Evidence / notes |
| --- | --- | --- | --- |
| RDS Postgres (pgvector) | CloudNativePG cluster | Apache-2.0 | Operator, backups to object storage, pgvector image from nixpkgs. |
| SQS (incl. FIFO) | Kafka, the same cluster as events (see [Queues on Kafka](#queues-on-kafka)) | Apache-2.0 | One durable, replicated system for events and work queues. ElasticMQ (**tested**: FIFO ordering and dedup work) is only a transitional shim while each queue moves, then it is removed. |
| DynamoDB | ExtendDB on the instance's Postgres | Apache-2.0 (AWS-maintained) | **Tested:** async create → ACTIVE, `TransactWriteItems`, conditional `ADD`, `begins_with` query, TTL, conditional-put failure. Imported fixed access keys. v0.1.x, so treat as early. |
| S3 | RustFS | Apache-2.0 | **Tested** as celld's backing store. Upstream still marks distributed mode as "under testing". Fallback: SeaweedFS (Apache-2.0). |
| Cloudflare Workers + Durable Objects, KV, D1, R2, Queues, Cron | celld | Apache-2.0 | **Tested** on RustFS: a Durable Object counter kept its state across a node restart. v0.6.3 covers every binding our workers use except Browser Rendering and rate limits. One fleet per worker per instance. `wrangler.toml` must become `wrangler.jsonc`. |
| Lambda | Plain Deployments, scaled by KEDA (Apache-2.0) on Kafka consumer lag | Apache-2.0 | The handlers already have local-worker forms (`document_upload_finalizer_local_worker`). No FaaS framework: Knative, Fission, and OpenFaaS add a runtime we don't need. |
| S3 event → SQS → Lambda | RustFS bucket notifications → Kafka topic → worker | — | To verify: RustFS's Kafka notification target. Fallback: a small poller that publishes to Kafka. |
| MSK (Kafka) | Strimzi, KRaft | Apache-2.0 | Same Kafka protocol; topics declared from `macro_event_topics`. |
| ElastiCache Redis | Valkey | BSD-3 | Drop-in. |
| OpenSearch Service | OpenSearch (operator) | Apache-2.0 | Same engine version (3.5) and `analysis-icu`. |
| KMS (envelope + encryption context) | OpenBao Transit behind our existing KMS port | MPL-2.0 | Transit is not the KMS wire API. Add an outbound adapter next to the AWS one and keep encryption-context binding (CS-72). |
| Secrets Manager / Doppler sync | Doppler → External Secrets Operator (Doppler provider) → Secrets | Apache-2.0 | Doppler stays the single source (config rule). `APP_SECRETS_JSON` comes from an ExternalSecret instead of ECS. |
| ALB + ACM | Traefik + cert-manager | MIT / Apache-2.0 | One ingress per cluster, one host per instance. |
| Datadog sidecars | OpenTelemetry Collector → Grafana LGTM (in-cluster) | Apache-2.0 / AGPL for Grafana's UI* | *Grafana, Loki, and Tempo are AGPL, used unmodified as a service; flagged for review. |
| Cloudflare Browser Rendering (ai-editing-worker) | Headless Chromium pod over CDP | BSD | Already exists locally (`docker/headless-chrome`). |
| Workers rate-limit binding (analytics-proxy) | Small rate-limit shim on Valkey | — | celld does not implement `ratelimits`. |

Kept as external providers behind ports: outbound email and mobile push. Each
gets a provider-neutral port with two adapters: SMTP to Mailpit (local and
every non-prod instance) and SES (prod) for email; a recording fake (local)
and SNS or direct APNs/FCM (prod) for push. No service imports `aws-sdk-sesv2`
or `aws-sdk-sns` directly. Also kept: FusionAuth (already a pod), Doppler.

### Queues on Kafka

Kafka (Apache-2.0) replaces SQS everywhere, so an instance runs one messaging
system. Mapping of the SQS features we use:

| SQS feature (uses in code) | On Kafka |
| --- | --- |
| Work queue, per-message delete (`receive`/`delete_message`) | Consumer group per queue; commit the offset after the handler succeeds. |
| Visibility timeout extension (5) | Not needed: a record is redelivered only if the consumer dies or exceeds `max.poll.interval.ms`, tuned per queue. |
| Redrive to a dead-letter queue | Retry topic with a delivery count header, then `<queue>.dlq` after N attempts. |
| FIFO message group (1) | Record key = group id, so one partition keeps the group's order. |
| Deduplication id (1) | Idempotent producer, plus an idempotent handler keyed by the dedup id. |
| Delay seconds (2) | A `<queue>.delayed` topic whose consumer holds each record until its due time, then republishes it. |
| Lambda-style scaling | KEDA's Kafka scaler on consumer lag. |

Kafka 4.2 made share groups (KIP-932, per-record ack like SQS) production-ready.
Its C client exposes them only as a preview (librdkafka 2.15), and the Rust
`rdkafka` crate does not expose them yet. The design above uses plain consumer
groups, which work today. A later switch to share groups stays inside the
adapter.

All of this lives behind one queue port in `sqs_worker`, renamed when it
moves. Services do not call `aws-sdk-sqs` or `rdkafka` directly. Queues are
declared in Nix next to the Kafka topics, from `macro_queues` and
`macro_event_topics`. Locally Kafka runs one broker; prod runs three, with
replication factor 3. That is a size difference, as the parity rule
allows.

### Service decomposition and gRPC

Today, 33 crates or services call each other over hand-written HTTP clients
(`*_service_client` crates) and shared internal auth keys, plus
SQS/Kafka-as-RPC. Target:

- `proto/` holds the service contracts. Codegen uses `buf`: tonic + prost for
  Rust (both already in the workspace), and connect-es for TypeScript callers.
- **Service-to-service auth** is workload identity instead of shared keys:
  Istio in ambient mode (Apache-2.0) gives automatic mTLS and per-service
  authorization policy without sidecars. Internal auth keys disappear. Not
  Linkerd: its stable releases are no longer published as open source.
- **Splitting:** each large service becomes several Deployments built from
  the same crates, one per bounded context (e.g. `document_storage_service`
  → documents, permissions, uploads). The hexagonal layout already separates
  domain services from inbound adapters, so a split is mostly a new composition
  root plus a gRPC inbound adapter.
- **Order:** start with the most-called boundary (authentication service
  client), then document storage. Each split lands behind the same proto, with
  the old HTTP route kept until callers move. Browser-facing APIs stay
  HTTP/JSON through the ingress.

This is the largest piece of work, and it is independent of the platform
move. The platform work does not wait on it.

### Fast iteration

The inner loop: `just dev <service>`:

1. Build with Cargo, incrementally, using the shared target dir and mold (same
   toolchain as the Nix build).
2. Wrap the binary in a store path. A tiny derivation takes the built binary
   as a path input and copies it to `$out`. Nix's reference scanner records
   its glibc and OpenSSL dependencies, so the closure is complete. This costs
   about 1 second; no crane rebuild of the workspace.
3. `buildImage` → `nix:0/...`, then patch the one Deployment. About 2 seconds
   measured (above).

The cluster pulls nothing over the network locally, because the node is the
build machine and shares its store. CI and prod build the same packages
reproducibly with crane. The artifact shape (a store-path image run by the
same manifest) is identical. Only the compile profile differs, and `just dev
--release` closes that gap when needed.

JS services (lexical, websocket) and celld fleets follow the same pattern: a
store path per build, plus `celld deploy`, whose nodes adopt new versions
without a restart.

Never on the inner path: rebuilding other services, restarting infra,
re-running migrations (they run as a Job only when the migrations directory
changes).

### Multiple instances per cluster

- **Per instance:** one namespace (`macro-<name>`) holding the services and
  the data plane: CNPG cluster, RustFS, ExtendDB, Kafka, OpenSearch,
  Valkey, FusionAuth, and the celld fleets. There are no cluster-scoped
  resources, and no names outside the namespace.
- **Per cluster:**
  - in `platform-*` namespaces: the operators (CNPG, Strimzi, OpenSearch,
    KEDA, External Secrets, cert-manager), Traefik, Istio (ambient), Argo CD, and the
    CI runner controller;
  - the binary cache.
- **Hostnames:** `<instance>.<cluster domain>`, with wildcard DNS and
  certificate.
- **Guardrails:** each instance gets a ResourceQuota from its size profile. A
  default-deny NetworkPolicy stops instances from reaching each other.
- **Prod** is the `prod` instance at the `prod` size.

### Auxiliary services

- **CI runners:** GitHub Actions Runner Controller (`gha-runner-scale-set`,
  Apache-2.0). Runners use Nix store-path images and the cluster binary cache,
  and run Kubernetes-mode jobs. Image builds no longer need Docker-in-Docker,
  because images are Nix builds.
- **Cloudflare bot and site workers** (anthropic-status-bot, goalert-bot,
  stripe-payment-bot, cla-worker, sdk-docs) become celld fleets in a `platform-bots`
  instance.
- **GoAlert and observability** run as pods in `platform-ops`.

## Phases and acceptance

1. **Machine.** The big-pickle flake gains the k3s and nix-snapshotter
   module. Done when the node is Ready, Docker still works, and the
   store-path pod boot test passes.
2. **Platform skeleton.** Nix modules for the operators, Traefik, and
   cert-manager, plus an `instance` module with the per-namespace data plane.
   Done when two empty instances start side by side, isolated by
   NetworkPolicy.
3. **Macro services.** Every Rust and JS service as a Nix package, image, and
   module; config through External Secrets; migrations as a Job. Done when
   `just instance up demo` serves the app and login works end to end, and
   `just dev <service>` replaces one pod in under 30 seconds.
4. **Replacements.** Move queues to Kafka behind the queue port (ElasticMQ
   covers any queue not yet moved); switch the AWS SDK endpoints to ExtendDB,
   RustFS, and OpenBao; email and push behind their ports; Lambdas to KEDA
   workers; Workers to celld. Done when
   the local E2E suite (`just local-e2e`) passes against an instance.
5. **Aux.** ARC runners and the bots on the cluster.
6. **AWS.** terranix/OpenTofu for nodes and networking; the dev instance on
   AWS; the parity check in CI.
7. **gRPC and splits.** Proceed boundary by boundary (runs in parallel from
   phase 3).
8. **Prod cutover.** A separate plan for data migration (RDS → CNPG, DynamoDB
   → ExtendDB, S3 → RustFS) and rollback.

## Resolved questions

1. **sync-service:** stays on Cloudflare in prod for now; runs in celld in
   every instance.
2. **Queues:** Kafka for everything ([Queues on Kafka](#queues-on-kafka)).
3. **Email and push:** external providers behind ports, with open-source
   adapters (Mailpit SMTP) for local and non-prod instances.
4. **Grafana's AGPL components:** accepted.
5. **Own control plane on AWS** instead of EKS: accepted, for parity.

## What happens to the prototype

- **Discarded:** the compose-to-Helm renderer (`xtask_local` `k8s` module),
  the `infra/k8s/macro-env` chart, and the workspace-bake Dockerfile. They
  translated the compose stack rather than replacing it.
- **Kept:** what was learned. Kafka needs its listener and controller ports as
  Services, and its Services must publish not-ready addresses. PVCs must be
  seeded like Docker volumes. On ZFS, kind needs overlayfs and
  `localStorageCapacityIsolation: false`; k3s on NixOS avoids kind entirely.
- **The test EKS cluster** (`infra/stacks/environments-cluster`, deployed to
  dev) is unused by this design. It should be destroyed to stop its cost.
