# Observability pilot

This stack starts Grafana alongside Datadog on one private EC2 instance. It
runs Grafana, Loki, Tempo, Prometheus, Alloy and nginx as native systemd services
on a prebuilt NixOS image. There is no Docker or Compose dependency. Nix owns
packages, configuration, service users, resource limits and startup dependencies:

- `nixos/services.nix`: native application services and runtime credentials.
- `nixos/grafana.nix` and `nixos/datasources.nix`: Grafana access policy and datasources.
- `nixos/backend-config.nix`: Loki, Tempo and Prometheus settings.
- `nixos/ingest.alloy`: unprivileged OTLP receiver and export pipeline.
- `nixos/host-telemetry.nix` and `nixos/host.alloy`: host metrics and journal logs.
- `nixos/cloudwatch.nix`: independent disk and memory health metrics.
- `nixos/proxy.nix`: native nginx virtual hosts and query-only backend gateway.
- `nixos/host.nix`: boot dependencies, retained storage and stable service identities.

NixOS modules generate application configuration from Nix attributes. Alloy's
pipelines live in native `.alloy` files read by Nix. Pulumi sends only
validated runtime values such as hostnames and bucket names.
Datadog instrumentation, collection and alerts remain unchanged. Nothing sends
application telemetry here until a subsequent dual-export change is deployed.

## Architecture and storage

```text
Team browser -- HTTPS --> ALB --> nginx --> Grafana -- Google Workspace OAuth
                                                 --> query proxy --> backends
OTEL exporter -- HTTPS + bearer token --> ALB --> nginx --> Alloy
                                                        --> Loki --> S3 logs
                                                        --> Tempo --> S3 traces
                                                        --> Prometheus --> EBS
```

- One `m7i.xlarge` (4 vCPU / 16 GiB) in a new VPC's private `us-east-2a`
  subnet in Ohio, separate from production in `us-east-1`. This is a provisional
  pilot size, not a capacity commitment.
- Independent regional dependencies: two public ALB subnets, one NAT gateway,
  a regional ACM certificate, EBS/snapshots, S3, Secrets Manager and alarm topic.
  An S3 gateway endpoint keeps bucket traffic off the NAT gateway. No production
  VPC, peering, NAT or regional certificate is reused. Route53 and IAM are global.
- Separate encrypted 300 GiB gp3 volume: Grafana SQLite and plugins,
  Prometheus TSDB, Alloy metrics WAL, Loki WAL/index/cache, Tempo WAL/blocks.
  The root disk is disposable. Volume and S3 buckets are protected and retained.
- Two private, encrypted S3 buckets, scoped instance-role access, HTTPS required.
  Loki/Tempo compactors own retention; no lifecycle rule can expire live blocks.
- Defaults: 30 days of logs, 7 days of traces, metrics up to 30 days or 100 GB,
  whichever is reached first. WAL/cache usage is additional, not covered by the
  metrics limit. Review ingestion volume and disk growth before broad rollout.
- Daily EBS snapshots retained for seven days; these are crash-consistent, not
  an application-consistent or cross-region backup. Snapshot recovery can lose
  up to a day of local state. S3 does not protect telemetry still buffered locally.
- No RDS, shared filesystem, Kafka or cluster. Grafana's SQLite stores users,
  dashboards and settings, not log/trace/metric history.
- All service and OS versions are pinned by this stack's `flake.lock` on NixOS
  26.05. Grafana plugin auto-install/update is disabled. Reviewed lock updates
  and replacement AMIs deliver upgrades; there is no installation or build at boot.

Previously received telemetry remains accessible if the production region fails.
Data that has not left production can still be lost, and a single Ohio host is
not highly available. Ohio failure is not covered by these regional snapshots
or buckets. Subsequent dual export must use independent queues and HTTPS across
regions, and account for inter-region transfer costs and latency. A production
region outage should not block Grafana login or secret retrieval in Ohio.

## Host and service collection

A native Alloy service collects CPU, memory, filesystem and network metrics
using its node exporter, including systemd unit state, tasks, restart counts and
start times. It reads selected application/systemd service logs and kernel logs
from the journal. Metrics go to Prometheus; logs go to Loki. Container discovery
and cAdvisor are unnecessary because the stack runs directly on systemd. Other
production hosts and application OTEL dual export are subsequent work.

The collector runs as a dedicated unprivileged user with journal access, separate
from the unprivileged OTLP ingress service. Its UI binds only to loopback, EC2
metadata access is blocked, and its memory limit is 1 GiB. State is retained on
EBS under `alloy`; the metrics WAL retains at most one hour of unsent samples.
Log delivery uses bounded retries and does not guarantee lossless delivery
through a long outage. Nginx access logs use a restricted format without query
strings and flow through journald into Loki, as do service errors. Host Alloy
uses the host mount namespace so filesystem metrics reflect the actual mounts;
Unix permissions restrict writes to its own retained directory.

CloudWatch Agent runs as a separate unprivileged NixOS service, independent of
the data mount and the application stack. It sends only root/data-disk utilization and memory
utilization to the `Macro/Observability` namespace using the instance role.
Alarms identify the current EC2 instance: either ext4 disk above 80% or memory
above 90% over two five-minute periods notifies the configured SNS topic.
Missing data breaches the alarm, including when the data volume is not mounted.
CloudWatch collection runs every minute. No custom disk polling script remains.

Both native agent versions are pinned by `flake.lock`; their NixOS modules own
startup and restart behavior. Verify dashboards and alarms with real EC2 data
before enabling broad production ingestion.

## Team authentication and security

Production URLs are `https://grafana.macro-internal.com` and `https://otlp.macro-internal.com`;
dev uses `grafana-dev.macro-internal.com` and `otlp-dev.macro-internal.com`.

Grafana uses a **Google Workspace OAuth client**. Every member of the `macro.com`
Workspace may sign in and receives Grafana server administrator and organization
administrator access. Google hosted-domain validation and the `macro.com` domain
restriction reject accounts outside that Workspace, including personal Google
accounts. ID-token signature validation, PKCE and refresh-token checking are enabled.
Workspace administrators must enforce MFA. No password login, default admin or
anonymous access is enabled; account creation happens only after Google login.
The role policy is declared directly in `nixos/grafana.nix`; there are no per-user
Pulumi access lists.

Sessions have a one-hour inactivity limit and eight-hour maximum. Suspending a
Workspace account does **not** immediately invalidate an existing Grafana session.
For offboarding, disable the Workspace account and use another Grafana admin to
disable the Grafana user and revoke their sessions. This uses OSS role mapping,
not Enterprise team sync. All team members can administer Grafana and query the
pilot's telemetry; there is no per-service data isolation. Apply redaction in the
producer pipeline before copying sensitive data.

Only the ALB is internet-facing, on TLS 1.2/1.3 port 443. The host has no public IP,
SSH key or SSH ingress. Its only ingress is port 8080 from the ALB security group.
ALB-to-host traffic is HTTP inside the VPC. Administrative access uses AWS SSM and
the operator's IAM identity. Grafana, Loki, Tempo, Prometheus and both Alloy
services bind to loopback. The default ALB action is 404. No HTTP listener is opened.

Grafana data sources use a separate internal nginx listener on port 8081 that
allows only named query endpoints and their required HTTP methods. This matters
because users can call Grafana's data-source proxy: direct backend URLs would
also expose maintenance endpoints such as Tempo `/shutdown` and Loki `/flush`
(including mutating GET requests). Port 8081 binds only to loopback, and
Alloy's ingestion path is separate. New data-source features may require reviewed
additions to this query allowlist.

Ingestion is a separate hostname permitting only POST to `/v1/logs`, `/v1/traces`
and `/v1/metrics`. Alloy validates a bearer token independently of browser login.
The token cannot query telemetry through that endpoint. Requests have an 8 MiB
limit and a shared 100 requests/second limit with a 200-request burst. Only use
this token in trusted server-side collectors, never browser or mobile clients.
The initial token is shared; provision per-producer credentials before expanding
beyond trusted internal services.

Secrets Manager holds Google client credentials, the Grafana encryption key and
the ingestion token. EC2 retrieves them at startup into `/run` with restricted
file permissions. Systemd `LoadCredential` gives Grafana only its three credentials
and ingress Alloy only the OTLP token. Secret values never enter Pulumi state,
user-data, environment variables or configuration committed here. Grafana's nonsecret hostname
and public URL are supplied through environment variables; the generated INI
refers to them through Grafana's environment provider. Secrets
remain file references in the Nix store, never secret values. The secret must use the
AWS-managed Secrets Manager encryption key; a customer-managed key needs an
explicit scoped KMS policy addition. IMDSv2 is required with hop limit 1. Only Loki, Tempo, the bootstrap/secret helper,
CloudWatch and SSM need the instance role; application units without an AWS
requirement block metadata access. The host is still one administrative trust
boundary; split roles/hosts when stronger isolation is required.

## First deployment

The stack is deliberately absent from `.github/services-config.json`, so this PR
does not enroll it in automatic deployments. Use the repository's Pulumi backend
and AWS account `569036502058`, region `us-east-2`. Deployment requires the
existing public `macro-internal.com` Route53 zone; this stack creates its own VPC/NAT and
DNS-validated regional ACM certificate. Region validation rejects `us-east-1`.

1. Use a Google OAuth Web client managed by the company. For a new dedicated
   client, choose an **Internal** consent audience. When reusing the application
   client, preserve its existing audience and redirect URIs; Grafana independently
   enforces the `macro.com` Workspace restriction. Add the exact redirect URI
   `https://grafana-dev.macro-internal.com/login/google` for dev or
   `https://grafana.macro-internal.com/login/google` for prod. Prefer separate clients
   and secrets per environment. Confirm Workspace MFA enforcement.
2. Through the approved secret-management process, create a Secrets Manager JSON
   secret in **us-east-2** containing `google_client_id`, `google_client_secret`,
   `grafana_secret_key`, and `otlp_token`. Generate independent cryptographically
   random values of at least 32 characters for the last two. Preserve
   `grafana_secret_key` through recovery; changing it can make stored credentials
   unreadable. Never paste secret values into shell commands, this file or PRs.
3. Select an existing **us-east-2** SNS topic
   with a confirmed, monitored subscription for infrastructure alarms. Its
   delivery destination must remain accessible during a production outage.
   Configuration rejects secrets and topics in another region; the host reads
   the local secret directly, without fetching credentials from production.
4. Build, publish and smoke-boot the NixOS image as described below. Set its
   reviewed Ohio AMI ID; there is deliberately no mutable "latest image" lookup.
5. Set the nonsecret configuration below, substituting actual identifiers.
   Placeholder credentials are not usable for deployment.

```bash
\cd infra
bun install --frozen-lockfile
\cd stacks/observability
pulumi stack select macro-inc/dev --create
pulumi config set aws:region us-east-2
pulumi config set amiId '<reviewed NixOS AMI ID in Ohio>'
pulumi config set secretArn '<existing Secrets Manager ARN>'
pulumi config set alarmTopicArn '<existing monitored SNS topic ARN>'
pulumi preview --diff
```

Deploy with `pulumi up` after
reviewing the resource plan. Allow up to 15 minutes for bootstrap.
Pulumi resource creation does not prove bootstrap or OAuth has succeeded.
Do not change the region of a stack that already owns resources: that requires
an explicit migration and recovery plan for its protected storage.

Before enabling application traffic, validate all of these against AWS:

- A `macro.com` Workspace member can log in with server and organization admin
  access. A different Workspace domain and personal Google accounts cannot log in.
- All three data sources pass their health checks. A small OTLP fixture appears
  in logs, traces and metrics with the expected `service.name`.
- Missing/wrong tokens fail; valid token cannot read backend APIs. No backend
  ports or SSH are reachable directly.
- S3 objects appear after flushing; IAM uses the expected two buckets only.
- Reboot preserves data and starts services; stop/replace the host and verify
  the existing volume is reattached. Restore a snapshot to an isolated host and
  verify SQLite/Prometheus/WAL recovery before relying on the backup.
- Host/systemd metrics and service logs appear in Grafana. CloudWatch's
  instance, target-health, root/data-disk and memory alarms reach the selected
  SNS subscription. Verify disk metrics use `InstanceId`, `path` and `fstype`
  dimensions, memory uses `InstanceId`, and missing data alerts. Confirm a daily snapshot is created. Inspect disk/queue
  growth before increasing ingestion. These alarms do not cover every data-path
  failure; keep Datadog primary and add end-to-end ingestion checks next.

## Operations and recovery

### NixOS image build and publication

From `infra/stacks/observability`, on an x86_64 Linux Nix builder:

```bash
nix build . --cores 2
python3 nixos/publish-image.py result '<private Ohio image-artifact bucket>'
```

The build produces a UEFI VHD with the complete host configuration. KVM speeds up
image creation; software emulation is supported but slower. The publishing command
is an explicit AWS write: it uploads the image, imports an encrypted snapshot and
registers a private AMI in `us-east-2`. It never launches or modifies an instance.
It requires an existing private S3 artifact bucket in Ohio and an operator with
the [VM Import permissions and service role](https://docs.aws.amazon.com/vm-import/latest/userguide/required-permissions.html)
plus image registration/tagging permissions. Use `--role` for a dedicated import
role; scope its S3 access to the artifact bucket. This role is separate from the
runtime EC2 role. Publishing credentials never enter the image.

Record the printed image SHA256, import task, snapshot and AMI ID with the release.
If publication is interrupted, inspect those identifiers before retrying; do not
blindly create duplicate import tasks. Retain the previous AMI and snapshot until
the replacement has passed acceptance checks. Remove obsolete image artifacts,
AMIs and their root snapshots through the normal infrastructure cleanup process;
they are separate from the protected telemetry volume and its daily snapshots.

Review the AMI and boot it in the pilot's private subnet before enabling ingestion.
Check SSM access, the OS version, exact data volume mount, service health, reboot,
secret-outage recovery and replacement/reattachment. Pin `amiId` only after review.
The AWS image import and actual EC2 boot checks require deployment access and are
separate from local configuration and startup validation.

For host changes or security updates, update `nixos/host.nix` or the pinned input
with `nix flake update nixpkgs`, build/test/publish a new image, then change `amiId`
and review `pulumi preview`. Do not run an ad-hoc `nixos-rebuild switch` on the
host: Pulumi's pinned image is the source of truth. Rolling back an AMI does not
roll back Grafana schema migrations or telemetry state; use a tested snapshot
recovery plan when the old application version cannot read current data.

### Runtime

Use SSM Session Manager with the `instanceId` output. On the host:

```bash
sudo systemctl status observability-bootstrap observability-secrets grafana loki tempo prometheus alloy alloy-ingest nginx
sudo journalctl -u observability-bootstrap -u observability-secrets --since boot
sudo journalctl -u grafana -u loki -u tempo -u prometheus -u alloy -u alloy-ingest -u nginx --since '30 minutes ago'
```

Nonsecret runtime values arrive as versioned, compressed JSON in EC2 user-data.
`read-user-data.py` retrieves them through IMDSv2 and validates the exact schema,
region, hostnames and bucket/volume/secret identifiers.
It writes a systemd environment file, nginx hostname maps, the secret's identifier
and the expected volume ID under `/opt/observability`. It does not execute
user-data or read secret values. The standard NixOS user-data evaluator is disabled.
Schema version 5 rejects older payloads, unknown settings and caller-supplied files.

`observability-bootstrap` mounts that exact EBS volume and creates each service's
data directory using stable, named NixOS users. `prepare-volume.sh` formats only
a disk with no filesystem or signatures; existing ext4 data is preserved.
Application units verify the mount before every startup, preventing fallback to
the root disk. Bootstrap retries every 30 seconds after metadata or attachment
failure, and its systemd `Upholds` relationships start dependents after recovery.

`observability-secrets` fetches the credential bundle into root-only files under
`/run`. Grafana and ingress Alloy wait for successful retrieval and receive private
credential copies from systemd. Secret-service outages retry every 30 seconds;
Loki, Tempo, Prometheus and host collection can run independently of that service.
Systemd restarts crashed processes individually with memory and filesystem limits.

Configuration/image changes require a new image and reviewed `amiId`; runtime
value changes do not need an image rebuild. Both kinds of changes replace the
instance and cause downtime. The old instance is deleted before replacement, its
volume is detached, then the new host waits for that retained volume. This pilot
has not been deployed with the earlier container layout; an existing container
installation would need an explicit ownership/path migration before using this image.

To rotate the OAuth secret or ingestion token, update Secrets Manager, then run
`sudo systemctl restart observability-secrets`. This stops Grafana and ingress
Alloy while credentials refresh, then restarts both with new private copies.
Restarting an individual application uses the last fetched bundle. For token
rotation coordinate producers and their retry queues; there is no dual-token
grace window. Do not casually rotate Grafana's encryption key.

For instance failure in the same AZ, replace the instance through Pulumi and
reuse its retained volume. Do not run two hosts against the same data directory.
For corrupt/lost data, select a known snapshot, set `dataSnapshotId`, and preview
the resulting volume/instance replacements. A deliberate recovery requires
removing Pulumi protection from the old volume before replacement; its
`retainOnDelete` setting preserves it for investigation. Verify the new volume's
ID and mounted data before accepting traffic. Cross-AZ recovery requires choosing
a private subnet in that AZ and restoring the snapshot there; the initial code
deliberately fixes the AZ. Never reformat an existing volume to resolve a mount
failure. Buckets are independent and should be reused during recovery.

This is a single point of failure. Alloy's logs/traces batch buffers and export
queues are in memory; successful OTLP acceptance is not an end-to-end durability
guarantee. Producer retries cover rejected requests, not accepted data lost in a
crash. Metrics remote-write has a local WAL. EBS-backed backend WALs protect data
already delivered to Loki/Tempo. Establish failure/loss tolerance while Datadog
still receives the authoritative copy.

## Dashboards and alert migration

### Service exploration

Nix installs the signed Logs, Metrics, and Traces Drilldown apps through
`services.grafana.declarativePlugins`. Their versions and download hashes come
from the pinned `flake.lock`; no plugin download or update happens at boot.
Use **Drilldown → Logs** to choose a service and inspect its log volume, fields,
and patterns, or **Drilldown → Traces** to filter services, errors, and latency.
The dev telemetry dashboard also has a service selector and links to all three
Drilldown apps. The service selector discovers names from dev logs; a service
that emits only traces or metrics can be found in the corresponding Drilldown.

Loki enables pattern ingestion, log-level detection, and volume queries. Tempo's
metrics generator enables TraceQL metrics, span metrics, and service graphs.
Generator WAL and local blocks use the retained data volume; metrics blocks flush
to the existing trace bucket, and generated metrics go to local Prometheus.
These metrics start accumulating after this image is deployed. They describe
received spans, so sampling and missing instrumentation can prevent parity with
Datadog request counts. Span names remain in Tempo rather than becoming unbounded
Prometheus labels. Generated series are capped at 50,000; monitor
`tempo_metrics_generator_registry_series_limited_total` and local-block discards
before expanding ingestion. The existing Tempo memory limit remains in force.

Tempo spans link to the service's logs in a time window and its generated metrics;
logs carrying an OTLP trace ID link back to the trace. FireLens logs do not always
carry trace IDs, so service/time correlation is not a claim of exact trace-to-log
matching. Service graph edges require correctly related client/server spans.
Profiles, database query monitoring, RUM/session replay, and complete Datadog
dashboard/monitor migration remain separate coverage work.

### Provisioned dashboards and alerts

Nix provisions the `Macro` dashboard folder, a dev telemetry dashboard, and a
CloudWatch database/Lambda dashboard. CloudWatch reads native metrics in Virginia;
it does not replicate their history to Ohio, so these panels depend on Virginia
remaining available. These are not a replacement for Datadog database query monitoring, RUM, or anomaly
models. Grafana uses the EC2 role for regional metric reads and publishing to the
configured alarm SNS topic. Other unprivileged HTTP/ingest services still cannot
access instance metadata.

`nixos/alerting.nix` starts with the three dev monitors declared in the monitoring
stack: DSS errors (1013923), channel-invite spam (4876245), and document text
extractor failure ratio (1291772). Warning and critical rules are separate and
mutually exclusive. Their windows and thresholds come from those definitions;
the Lambda ratio sums four hours ending fifteen minutes ago. No-data is OK for
these event-count/error-ratio rules, while datasource execution errors remain
errors. Notification grouping and repeat timing are Grafana settings, not exact
copies of Datadog notification behavior.

All migrated rules initially remain **paused**. Confirm source coverage and query
results before enabling each rule. The channel-invite monitor's old `processing
message` event was not found in current notification source, so it particularly
needs reconciliation against live logs. Paused rules do not imply healthy coverage.
Production telemetry monitors remain in Datadog. Complete the live dashboard and
monitor inventory before claiming parity; repository definitions may have drifted.

The `Macro team email` contact point publishes through SNS using the host role,
without SMTP credentials. The configured topic already has wolf@macro.com and
teo@macro.com subscriptions; each recipient must confirm their SNS subscription.
Test the contact point and verify receipt before relying on notifications.

This release adds `alarmTopicArn` to user-data schema 5. Deploy it together with
the new reviewed AMI; a schema-4 image cannot boot schema-5 user data.

## Dev dual export

Every dev ECS service using the shared Datadog sidecars automatically also runs
Alloy; there is no per-service opt-in flag. Task definitions call the shared
`withTelemetry(serviceName, containers)` helper, which supplies the Datadog agent,
FireLens router, dev Alloy sidecar, and dev Grafana environment variable together.
Production keeps its existing Datadog configuration
until its rollout. The earlier `image-proxy-service` canary verified Ohio
ingestion; it used the superseded collector-in-front-of-Datadog design. The
current design keeps applications exporting directly to the Datadog agent. The execution role can read the ingestion-only
`observability/dev-ingest` secret in Virginia.
The application task role does not receive access to the Grafana OAuth bundle.

Applications keep their original Datadog trace exporter at loopback 4317. In dev
ECS tasks, `GRAFANA_OTLP_ENDPOINT` is injected automatically as
`http://127.0.0.1:14317` (registered in Doppler `observability/dev`). The shared
Rust entrypoint adds a second batch processor with its own bounded queue, copying
the same finished spans and trace IDs to Alloy. It does not change Datadog's
exporter, filtering, sampling or agent configuration. Local and production runs
do not add this exporter. This requires rebuilding the application images.

Alloy listens on loopback OTLP 14317/14318 and exports only to Ohio. FireLens
retains its existing Datadog output and parsing and adds a bounded-retry Fluent
Forward output to Alloy for logs. ECS metadata supplies task and container
metrics; identity is promoted into metric labels to keep replicas separate.
The extra container reserves 128 MiB with a 512 MiB hard limit; review Fargate
sizing during each stack preview. Alloy is non-essential: its failure does not
restart the application or Datadog. ECS does not automatically restart a stopped
non-essential container in this configuration; replace the task to recover it.

The Grafana branch batches asynchronously before its memory limiter. Overflow,
export failure, or task replacement can drop the optional copy. Failed optional
trace exports are deliberately suppressed so a Grafana outage does not generate
SDK export-error logs that feed existing Datadog alerts. The optional SDK queue
is limited to one 512-span batch, so draining it plus an in-flight batch fits the
five-second shutdown budget. Queue saturation can still emit SDK drop warnings. These queues are
not durable. Collector processes still share task resources, and FireLens shares
its input and parsing between the two outputs; this is not complete resource
isolation. Any future application metric SDK needs its own independent Grafana
reader/exporter; the Rust entrypoint currently exports traces, not app metrics.

The dev analytics proxy mirrors existing browser and worker OTLP traces/logs in
`waitUntil`, using a server-side token and a five-second export timeout. Browsers
send once. Payloads above 8 MiB skip only the mirror. Each Worker isolate admits
at most two concurrent copies; additional requests skip mirroring to bound
aggregate buffering. Datadog's response remains
the client response. `deploy-analytics-proxy-dev.yml` installs the token from
Secrets Manager and deploys only the dev Worker.

The manually dispatched `export-datadog-observability.yml` reads live dashboard/monitor definitions into a
seven-day GitHub artifact for the migration inventory. It never modifies Datadog. The current repository credentials return HTTP 403
for both reads; `monitors_read` and `dashboards_read` access must be restored
before claiming live inventory parity. Partial exports retain an explicit status file.
The live legacy agent-proxy/document-processing services outside the current
stack definitions and the CloudWatch-logged preview gateway need a separate
coverage pass. Lambda CloudWatch logs, RUM/session replay, synthetics and database query monitoring
are separate sources; ECS/edge OTLP duplication alone does not provide parity.

## Validation and subsequent passes

From `infra/`, run `bunx biome check stacks/observability` and `bun run check`.
Build the complete NixOS image from this stack directory with `nix build . --cores 2`.
Before publishing an image, validate native service startup, Google authorization redirects,
anonymous/token denial, three-signal ingestion/readback, S3 flushing, process
restart recovery and systemd credential/storage permissions in an isolated local
fixture. Real Google login, AWS IAM, EC2 attachment/boot, ALB/TLS and snapshot
restore remain the deployment acceptance checks above.

Follow-up PRs:

1. Duplicate OTEL at the existing collector to both Datadog and this stack with
   independent bounded queues, retries and matching sampling. Check actual
   metrics temporality and attribute mapping before enabling all services.
2. Inventory non-OTEL sources: Datadog agents, infrastructure metrics, CloudWatch,
   RDS/Postgres query monitoring and logs, browser RUM, synthetics, profiling and
   security features. They are not covered by duplicating OTLP. Add DB collectors
   with dedicated read-only monitoring identities and evaluate query-level
   parity before replacing Datadog DBM.
3. Port dashboards/alerts and run representative incidents in both tools. Add
   pipeline/queue alerts, ingestion canaries, host/root-disk monitoring and a
   tested restore procedure. Measure volume, cost, query latency and data gaps.
4. Decide whether to split services or add replicas. Loki/Tempo can reuse S3;
   metrics need a deliberate remote-store/migration plan. Move Grafana metadata
   to managed Postgres/RDS before multiple Grafana instances. Cut off Datadog only
   after coverage and operational acceptance are demonstrated.

References: [Google OAuth](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/google/),
[Alloy bearer authentication](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.auth.bearer/),
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/),
[Tempo supported versions](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/recommended-versions/).
