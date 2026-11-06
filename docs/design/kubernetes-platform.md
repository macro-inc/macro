# Macro on Kubernetes, declared in Nix

Status: approved spec, partly implemented. See
[Implementation status](#implementation-status). The earlier compose-to-Helm
prototype on this branch is superseded (see
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
8. **Self-hostable.** Customers can run Macro on their own Kubernetes cluster
   without Nix, from a Helm chart and ordinary OCI images.

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

- **Local:** a NixOS module in the big-pickle flake enables `services.k3s` and
  a loopback OCI registry. It runs beside the existing Docker daemon, with
  non-overlapping pod and service CIDRs and no host ports in Docker's ranges.
- **AWS:** NixOS EC2 instances running the same k3s module, three servers with
  embedded etcd plus an agent pool. They are provisioned by OpenTofu (from
  terranix) and configured with `nixos-anywhere` and `colmena`.
- **EKS is possible again:** the original reason to avoid it was that store-path
  images needed Nix on every node, and that no longer applies. Nothing in the
  platform now depends on the node's distribution. We keep k3s for local/prod
  parity, but this is worth revisiting before the AWS phase.

### Images: OCI images built by Nix, in a registry

No Dockerfiles. Each component is a Nix package plus one `image` call
(`infra/platform/lib.nix`), and the result is an ordinary OCI image in a
registry. Any conformant cluster can run it, which is what self-hosting needs.

Both Nix frameworks were measured pushing a real service (a 388 MB binary, a
1.1 GiB closure) to a local registry:

| | Cold build + push | Rebuild + push after one change |
| --- | --- | --- |
| Official `dockerTools.streamLayeredImage` | 10.1 s + 19.1 s | 3.8 s + 17.0 s |
| Community `nix2container` | 27.3 s + 54.4 s | **3.0 s + 5.9 s** |

- **We use nix2container.** The rebuild loop is what we run all day, and it wins
  there because it skips layers the registry already holds instead of streaming
  the whole image. The official builder is simpler, ships in nixpkgs, and wins a
  cold push. Switching means replacing one function.
- **Layers are store paths,** so images share what they have in common across
  services, in the registry and in containerd.
- **Tags are store hashes,** known at eval time, so a manifest names an exact
  build and nothing floats.
- **The registry is outside the cluster:** Distribution (Apache-2.0) on loopback
  locally, ECR or similar on AWS. It survives the cluster being rebuilt, and no
  image has to exist before the cluster can start.
- **Upstream images are fine for tools we do not modify.** Argo CD, Gitea, and
  the Docker daemon for CI use their published images through their charts.
  Macro's components, including third-party ones we configure, are built by Nix.
- **Replaces nix-snapshotter,** which pulled in 99 ms but needed Nix on every
  node, could not serve self-hosters, and was community-supported in k3s.

### Manifests and delivery: nixidy and Argo CD

- Each component is declared in Nix. [nixidy](https://github.com/arnarg/nixidy)
  types the resources and renders plain YAML, one directory per Argo CD
  Application. It replaces kubenix, which was experimental; nixidy generates its
  own resource options from the Kubernetes API.
- An **instance** renders into namespace `macro-<name>` as one Application.
- **Every environment deploys the same way.** `cargo x platform` commits the
  rendered YAML to `platform/deploy` in the forge. Argo CD syncs it, with automated
  prune and self-heal. An instance exists because its directory is in git, and
  `platform down` removes the directory.
- **Sync waves give the order:** data plane, then the provisioning Job, then the
  services. This replaces the apply order `cargo x platform` used to run itself.
- **Secrets never enter the repo.** `platform up` applies them directly. External
  Secrets replaces that in the AWS phase.
- **Each instance generates its own internal credentials** once, for its databases,
  service-to-service calls, JWTs, and FusionAuth, and manifests reference them by key.
  An instance that existed before this keeps the development values its data was
  created with.
- **Parity check:** `nix build .#platform.parity` renders an instance at the `local`
  and `prod` sizes and diffs them, on every pull request that touches the platform.
  Only replicas, resources, and volume sizes may differ; anything else fails the build.
  Hostnames, the registry, and secret references come from outside the sizes, so they
  do not vary in this comparison. No prod instance exists yet; `sizes.prod` is what it
  will start from.

### Forge and CI: Gitea

- **Gitea** (MIT) hosts the deploy repo, a mirror of this repo, and CI. Forgejo
  has the same features and Actions model but is GPL, which the permissive
  license rule excludes. GitLab was too heavy for the job.
- **GitHub stays the source of truth for now.** `cargo x platform mirror` pushes
  main and the current branch and opens a pull request, which is what runs CI.
  Moving the source of truth is a separate decision.
- **CI is derived, not rewritten.** `cargo x workflows` generates `.gitea/workflows`
  from the same Rust definitions as `.github/workflows`, rewriting the runner label
  and dropping Namespace cache steps. The forge sets `WORKFLOW_DIRS` to read only
  `.gitea/workflows`, so the allowlist in `xtask_workflows/src/workflows/forge.rs` is
  everything that can run there, and a test keeps deploys out of it. It holds no
  deploy credentials either.
- **Runners** are `act_runner` beside a Docker daemon, one job at a time per
  replica, each with its own Docker data and Nix store. Each job gets a clean
  Ubuntu container, like a hosted runner.
- **Ported:** 11 of 61 workflows, the non-deploying pull request checks.
- **Not ported yet:** deploys and releases (they target AWS and should move with
  the AWS phase, not before), native builds that need macOS or Windows, Android's
  check, and workflows tied to GitHub itself (labels, CLA, the privacy check).

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
| Lambda | Plain Deployments, scaled by KEDA (Apache-2.0) on queue depth | Apache-2.0 | The handlers already have local-worker forms (`document_upload_finalizer_local_worker`). No FaaS framework: Knative, Fission, and OpenFaaS add a runtime we don't need. |
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

Kafka (Apache-2.0) stores every queue, so an instance runs one messaging system.

**Services keep the SQS API.** `services/queue_gateway` serves that API and keeps
messages in Kafka. The first version of this design put a new queue port in front of
services, but over twenty call sites across `notification`, `reminders`,
`calendar_events`, `slack_integration`, and others use `aws_sdk_sqs` directly.
Rewriting them would put production code at risk for a change production does not
need. The gateway needs no service changes and production stays on real SQS. A port
remains the right move if production ever leaves SQS.

| SQS feature | In the gateway |
| --- | --- |
| Work queue, per-message delete | One topic and consumer group per queue. An offset commits only when every message before it is deleted, so a crash redelivers what was in flight. |
| Visibility timeout and extension | Tracked in memory per message. |
| Redrive to a dead-letter queue | Republished after `maxReceiveCount`, and committed only once the dead-letter queue has it. |
| FIFO message group | Record key is the group id; one partition per queue; one message per group in flight. |
| Deduplication id | Five-minute window, in memory. |
| Delay seconds | The record holds its due time. |

Limits to know about: `ApproximateReceiveCount` and the deduplication window reset on
restart, and each instance runs one gateway replica. Both are acceptable for instances
and would not be for production, which is another reason it stays on SQS. Share groups
(KIP-932) could replace the in-memory tracking once `rdkafka` exposes them.

Queue-driven Lambdas scale with KEDA's SQS scaler pointed at this gateway, from zero
locally. It was chosen over the planned Kafka lag scaler: Kafka advertises a name that
only resolves inside its instance's namespace, the same resources work unchanged on real
SQS, and in-flight messages count, so a worker is not scaled away mid-invocation. The
self-host chart keeps fixed replicas, so it does not require KEDA.

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

The inner loop, `just platform dev <service>`:

1. Build with Cargo, incrementally, using the shared target dir.
2. Wrap the binary in a store path. A tiny derivation pins its loader and library
   path and strips debug info, which is most of a debug build's size.
3. Build the image and push it. Only the changed layer uploads.
4. Render, commit to the deploy repo, and ask Argo CD to refresh. The one
   Deployment whose image changed rolls.

Measured on 2026-11-04 with a real one-file change to `email-service`, on the
shared host at load 20 to 30: **about 43 seconds** end to end, of which Cargo
took 3 s for that change, Nix 15 s, the push under 1 s, and the Argo CD sync and
rollout 14 s. The rest is `nix develop` and `cargo x` starting. A larger Rust
change adds its compile time. One run in five took 3m45s, in the sync wait; the
cause is not yet known. The first `dev` of a service compiles a feature-set
variant of its dependencies once, which took about 2 minutes.

Services build in `target/platform`, because `cargo x` rebuilds its own tool with
different features first, and in a shared target dir that recompiles `ring` and
everything above it on every run. Wrapping, images, and rendering share one Nix
build, because a flake evaluation is most of the cost of each.

CI and prod build the same packages reproducibly with crane. The artifact shape
is identical. Only the compile profile differs.

JS services (lexical, websocket) and celld fleets follow the same pattern: a
store path per build, plus `celld deploy`, whose nodes adopt new versions
without a restart.

Never on the inner path: rebuilding other services, restarting infra,
re-running migrations (the provisioning Job re-runs only when its image or the
environment changes).

### Multiple instances per cluster

- **Per instance:** one namespace (`macro-<name>`) holding the services and
  the data plane: CNPG cluster, RustFS, ExtendDB, Kafka, OpenSearch,
  Valkey, FusionAuth, and the celld fleets. There are no cluster-scoped
  resources, and no names outside the namespace.
- **Per cluster:**
  - Traefik, Argo CD, the forge and its runners, in their own namespaces, deployed
    by `cargo x platform cluster` and then managed by Argo CD;
  - planned, as they land: the operators (CNPG, Strimzi, OpenSearch, External
    Secrets, cert-manager) and Istio (ambient);
  - the image registry, outside the cluster.
- **Hostnames:** `<instance>.<cluster domain>`, with wildcard DNS and
  certificate.
- **Guardrails:** each instance gets a ResourceQuota from its size profile. A
  default-deny NetworkPolicy stops instances from reaching each other.
- **Prod** is the `prod` instance at the `prod` size.

### Self-hosting

Customers run any conformant Kubernetes, without Nix on their nodes, and without
Argo CD or the forge. The same component modules emit a Helm chart; nothing is
maintained twice:

- **Images:** the same OCI images our own clusters run. Release CI pushes them to
  a public registry, tagged by release.
- **Helm chart:** a release step renders an instance with placeholder values
  and turns the result into a chart (`macro`). Templated values: host and
  TLS, size profile (replicas, resources, storage), image registry and tag,
  and the secret references (`macro-env` and the identity kickstart). These are
  exactly the fields the parity rule already allows to differ. The chart is a
  generated artifact; CI fails if it drifts from the modules.
- **Data plane choice:** the chart bundles the open-source data plane by
  default (Postgres, Kafka, OpenSearch, Valkey, RustFS, ExtendDB, celld), and
  each component can be switched off in favour of an external endpoint (a
  customer's managed Postgres or S3).
- **Mobile push:** `infra/platform/push-sink` answers SNS as Mailpit answers SMTP: it
  remembers endpoints, logs each publish's target and size, and sends nothing. A real
  deployment needs a real provider, through `sns_client`.
- **Key management:** OpenBao's transit engine, behind `services/kms_gateway`, which
  serves the KMS API. Its static seal unseals it unattended, from a key in `macro-env`.

### Auxiliary services

- **CI runners:** see [Forge and CI](#forge-and-ci-gitea).
- **Cloudflare bot and site workers** (anthropic-status-bot, goalert-bot,
  stripe-payment-bot, cla-worker, sdk-docs) become celld fleets in a `platform-bots`
  instance.
- **GoAlert and observability** run as pods in `platform-ops`.

## Phases and acceptance

1. **Machine.** The big-pickle flake gains the k3s and registry module. Done when
   the node is Ready, Docker still works, and a Nix-built image runs in a pod.
2. **Platform skeleton.** Nix modules for the operators, Traefik, and
   cert-manager, plus an `instance` module with the per-namespace data plane.
   Done when two empty instances start side by side, isolated by
   NetworkPolicy.
3. **Macro services.** Every Rust and JS service as a Nix package, image, and
   module; config through External Secrets; migrations as a Job. Done when
   `just instance up demo` serves the app and login works end to end, and
   `just dev <service>` replaces one pod in under 30 seconds.
4. **Replacements.** Move queues to Kafka behind the SQS API; switch the AWS SDK endpoints to ExtendDB,
   RustFS, and OpenBao; email and push behind their ports; Lambdas to KEDA
   workers; Workers to celld. Done when
   the local E2E suite (`just local-e2e`) passes against an instance.
5. **Aux.** Gitea, its runners, and the bots on the cluster.
6. **AWS.** terranix/OpenTofu for nodes and networking; the dev instance on
   AWS; the parity check in CI.
7. **Self-hosting.** The OCI images plus the generated Helm chart, published per
   release. Done when the chart installs on a stock
   cluster (kind) and passes the E2E suite.
8. **gRPC and splits.** Proceed boundary by boundary (runs in parallel from
   phase 3).
9. **Prod cutover.** A separate plan for data migration (RDS → CNPG, DynamoDB
   → ExtendDB, S3 → RustFS) and rollback.

## Implementation status

Built and exercised on the local cluster (`infra/platform`, `cargo x platform`):

- **Phase 1:** k3s and the image registry on the machine, through a NixOS module.
- **Phase 2:** the instance module, ingress, per-instance TLS, and NetworkPolicy
  isolation. Two instances were verified side by side before the move to Argo CD,
  and not again since.
- **Delivery:** Nix-built OCI images, nixidy, the deploy repo, and Argo CD with sync
  waves. Argo CD reports every Application Synced and Healthy.
- **Pipelines through Kafka:** an S3 write reaches the upload finalizer (RustFS webhook,
  bridge, queue), and a queued message reaches an unmodified Lambda handler. The gateway
  passes 27 behaviour checks against real Kafka, and keeps in-flight messages and queue
  settings across a restart. Processing a real document through them is not verified.
- **Phase 3, for the core app:** every Rust service in the inventory, lexical,
  websocket, the edge, and the frontend. Sign-up reaches onboarding in a browser
  on these images.
- **Phase 4, in part:** RustFS, ExtendDB, OpenBao behind a KMS gateway, and the
  Kafka-backed queue gateway behind one AWS gateway; sync-service, analytics-proxy, and ai-editing-worker as celld fleets;
  Valkey for Redis; provisioning as in-cluster Jobs; eleven Lambda handlers,
  unmodified, behind `lambda-runner`. Search indexing has not been verified.
- **Phase 5, in part:** Gitea, its runners, and CI checks. See CI status below.
- **Phase 7, in part:** `cargo x platform chart --release` builds the Helm chart and
  release images from an instance's manifests. On a stock kind cluster, a plain
  `helm install` with only `cargo x platform secrets` output reaches every pod ready,
  and the app, sign-in mail, and key management work. The E2E suite has not run against
  a release.
- **Two instances:** `demo` and `demo-2` ran side by side with separate credentials, and
  neither could reach the other's services or see its mail. Removing one left the other
  running untouched.
- **Web E2E:** the Playwright suite signs in and loads real data from an instance. The
  same commit gives the same 8 passes on the instance and on compose. Every test that
  fails on the instance also fails on compose, so those come from the tests or the shared
  harness, not the platform; four channel tests pass on the instance and fail on compose.
  No workflow runs this suite.
- **Bucket events:** a document written to `doc-storage` reaches `search_upload_handler`
  through the bridge, scaling it from zero, and it relays the upload for indexing; a file
  in bulk-upload staging reaches its trigger. The hourly cleanup CronJob runs to
  completion.
- **Queue scaling:** KEDA takes a queue worker from zero to its maximum as messages
  arrive and back to zero after they drain, on the local cluster.
- **Generated credentials:** a new instance bootstraps from nothing with its own, reaches
  sign-up, and rejects the old development values.
- **Rust E2E suite:** 16 pass, on queues in Kafka and with generated credentials. One assertion in
  `scoped_bot_resolves_document_access_through_dss` fails, and fails the same way
  on a plain compose stack, so the platform does not cause it.

**CI status (forge, 2026-11-05).** The ported checks run on Gitea, including the whole
Rust test suite against Postgres, dependency, generated code, conventions, infra, parity,
and AWS validation checks, web typecheck and build, and 61 Playwright functional tests.
Two remain: web `Test` is intermittent, with tests under `apps/web/scripts` timing out
when the host is heavily loaded, and cargo-deny reports a new advisory that `pin-utils`
is unmaintained, which is not specific to the forge.

**Playwright has not run against an instance.** Its downloaded browser cannot start on
the NixOS host, and a forge job would need network access to the instance.

Not built yet:

- The bots, and deploys on the forge.
- Phase 6's deployment: the terranix configuration renders and passes `tofu validate`
  in CI (`.#platform.awsCheck`), but it has never been planned against an account or
  applied. Node configuration, ECR pull credentials on k3s, and the AWS image push are
  not wired.
- Phases 8 and 9: gRPC and service splits, and the prod cutover.
- Word upload, which the local compose stack does not run either. The web app runs it as a
  job over the storage WebSocket, and `convert_service` and `docx_unzip_handler` report
  the result by invoking a job-update Lambda. That WebSocket API and Lambda belong to a
  separate stack outside this repository, and the local `websocket-service` is a stub,
  so the conversion services alone would not make uploads complete.
- Handlers the instance does not run: `image_optimizer` (a function URL),
  `call_recording_preview_handler` (needs ffmpeg and call recordings), and the SES ones,
  `dataloss_prevention_handler` and `email_suppression_handler`, which Mailpit makes
  moot. `worker_trigger` only starts `sha_cleanup_worker` on ECS, which instances run as a
  CronJob, and `mcp_auth_proxy` runs inside the agent harness.
- The rest of phase 7: publishing the images and chart per release, and a
  production-sized install. **The chart is a preview, not safe for real data**, and
  says so in its README: mail goes to Mailpit, OpenBao's seal key sits in `macro-env`, Kafka and OpenSearch have no authentication
  inside the namespace, and signed URLs use placeholder CloudFront keys.
- Release images on our own instances, which still wrap host-built debug binaries with
  debug info stripped, for the fast loop.
- Mirroring from GitHub automatically, which needs a credential decision.

Deviations from the decisions above, to revisit in the AWS phase:

- Postgres, Kafka, and OpenSearch run as plain single-replica Deployments, not
  under CloudNativePG, Strimzi, or an OpenSearch operator. There is no failover
  or backup yet, so this is not prod-ready.
- The env Secret comes from `cargo x platform`, not External Secrets.
- The forge uses SQLite and one replica. Argo CD syncs from the forge it also
  manages, so losing the forge pauses delivery; `platform cluster` can re-apply it.

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
- **Also replaced:** kubenix and nix-snapshotter, used in the first working
  version of this platform.
- **Kept:** what was learned. Kafka needs its listener and controller ports as
  Services, and its Services must publish not-ready addresses. PVCs must be
  seeded like Docker volumes. On ZFS, kind needs overlayfs and
  `localStorageCapacityIsolation: false`; k3s on NixOS avoids kind entirely.
- **The test EKS cluster** has been destroyed, and its stack removed.
