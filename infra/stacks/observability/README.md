# Observability pilot

This stack starts Grafana alongside Datadog on one private EC2 instance. It
provisions Grafana, Loki, Tempo, Prometheus and Alloy using Docker Compose on a
prebuilt NixOS image. Nix declares host packages, Docker, service dependencies,
host collectors and access policy. All service configuration is authored in Nix:

- `nixos/application-config.nix`: Grafana settings, datasources, Alloy pipeline
  and the assembled configuration output.
- `nixos/backend-config.nix`: Loki, Tempo and Prometheus settings as attribute sets.
- `nixos/containers.nix`: pinned images, resource limits, mounts and service flags,
  including Prometheus retention.
- `nixos/host-telemetry.nix`: native Alloy and CloudWatch Agent services.
- `nixos/host-alloy.nix`: standard host/container metrics and log collection.
- `nixos/cloudwatch.nix`: independent disk and memory health metrics.
- `nixos/proxy.nix`: structured nginx virtual hosts and locations for ingestion
  routing and the query-only backend gateway.

Nix generates the required INI/YAML/JSON/Alloy/nginx templates into the image;
there are no separately maintained copies. Alloy retains its native pipeline
syntax inside a Nix multiline string; nginx uses attribute sets for virtual hosts
and locations, with native directives in `extraConfig`. Pulumi owns AWS resources
and sends only validated runtime values such as hostnames, bucket names and
approved identities.
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
- Container releases are pinned by version and image digest in `nixos/containers.nix`.
  Grafana plugin auto-install/update is disabled; upgrades go through review and
  the smoke test. Host packages are pinned by this stack's own `flake.lock` on
  NixOS 26.05; reviewed lock updates and replacement AMIs deliver host patches.
  There is no package installation, channel update or Nix build during boot.

Previously received telemetry remains accessible if the production region fails.
Data that has not left production can still be lost, and a single Ohio host is
not highly available. Ohio failure is not covered by these regional snapshots
or buckets. Subsequent dual export must use independent queues and HTTPS across
regions, and account for inter-region transfer costs and latency. A production
region outage should not block Grafana login or secret retrieval in Ohio.

## Host and container collection

A native NixOS Alloy service collects CPU, memory, filesystem and network metrics
using its node exporter, and container CPU/memory/network/disk metrics using
cAdvisor. It also reads Docker logs for this Compose project, selected systemd
service logs and kernel logs. Metrics go to Prometheus; logs go to Loki. Other
production hosts and application OTEL dual export are subsequent work.

The native collector is separate from the unprivileged OTLP ingestion container.
cAdvisor and Docker discovery require privileged host access; native Alloy runs
as root with a loopback-only UI, filesystem hardening and a 1 GiB memory limit.
Its node exporter reads `/proc/1/root` to measure host filesystems through that
hardening. Docker metadata labels are limited to Compose project/service;
container metrics and logs are restricted to this stack. EC2 metadata access is
blocked for this service. Collector state is retained on EBS under `host-alloy`;
the metrics WAL retains at most one hour of unsent samples. Log delivery uses
bounded retries and does not guarantee lossless delivery through a long outage.

CloudWatch Agent runs as a separate unprivileged NixOS service, independent of
Docker and the data mount. It sends only root/data-disk utilization and memory
utilization to the `Macro/Observability` namespace using the instance role.
Alarms identify the current EC2 instance: either ext4 disk above 80% or memory
above 90% over two five-minute periods notifies the configured SNS topic.
Missing data breaches the alarm, including when the data volume is not mounted.
CloudWatch collection runs every minute. No custom disk polling script remains.

Both native agent versions are pinned by `flake.lock`; their NixOS modules own
startup and restart behavior. Verify dashboards and alarms with real EC2 data
before enabling broad production ingestion.

## Team authentication and security

Production URLs are `https://grafana.macro.com` and `https://otlp.macro.com`;
dev uses `grafana-dev.macro.com` and `otlp-dev.macro.com`.

Grafana uses a dedicated **Google Workspace OAuth client**. Only explicitly
approved lowercase `@macro.com` emails in `allowedEmails` may sign in; membership
in the domain alone is insufficient. Named `adminEmails` get Grafana server
administrator access; other approved users are Viewers. Admins must also appear
in the allowlist. Unknown identities map to an invalid role and are denied with
`role_attribute_strict`. Google hosted-domain validation, ID-token signature
validation, PKCE and refresh-token checking are enabled. Workspace administrators
must enforce MFA for the approved accounts. No password login, default admin,
anonymous access or public signup is enabled.

Sessions have a one-hour inactivity limit and eight-hour maximum. Removing an
email from configuration blocks the next login; it does **not** immediately
invalidate an existing session. For offboarding, first disable the user and
revoke their sessions in Grafana using another admin, then update the allowlist.
Keep at least two admins. This uses OSS role mapping, not Enterprise team sync.
All approved users can query the pilot's telemetry; there is no per-service data
isolation. Apply redaction in the producer pipeline before copying sensitive data.

Only the ALB is internet-facing, on TLS 1.2/1.3 port 443. The host has no public IP,
SSH key or SSH ingress. Its only ingress is port 8080 from the ALB security group.
ALB-to-host traffic is HTTP inside the VPC. Administrative access uses AWS SSM and
the operator's IAM identity. Loki, Tempo, Prometheus and Alloy have no published
externally reachable host ports; Grafana queries them over the private Docker
network. Loki and Prometheus also bind to host loopback for native Alloy writes. The default ALB
action is 404. No HTTP listener is opened.

Grafana data sources use a separate internal nginx listener on port 8081 that
allows only named query endpoints and their required HTTP methods. This matters
because Viewers can call Grafana's data-source proxy: direct backend URLs would
also expose maintenance endpoints such as Tempo `/shutdown` and Loki `/flush`
(including mutating GET requests). Port 8081 is not published on the host, and
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
file permissions; secret values never enter Pulumi state, user-data, container
environment variables or configuration committed here. Grafana's nonsecret host
and approved-user role expression are supplied through environment variables;
the generated INI refers to them through Grafana's environment provider. Secrets
remain file references in the Nix store, never secret values. The secret must use the
AWS-managed Secrets Manager encryption key; a customer-managed key needs an
explicit scoped KMS policy addition. IMDSv2 is required with hop limit 2 so Loki
and Tempo can use the instance role from containers. The single host is one trust
boundary: containers share network access and can potentially use that role.
Split roles/hosts when that boundary is no longer acceptable.

## First deployment

The stack is deliberately absent from `.github/services-config.json`, so this PR
does not enroll it in automatic deployments. Use the repository's Pulumi backend
and AWS account `569036502058`, region `us-east-2`. Deployment requires the
existing public `macro.com` Route53 zone; this stack creates its own VPC/NAT and
DNS-validated regional ACM certificate. Region validation rejects `us-east-1`.

1. Create a dedicated Google OAuth Web application under the company's Google
   organization with an **Internal** consent audience. Register exactly
   `https://grafana-dev.macro.com/login/google` for dev or
   `https://grafana.macro.com/login/google` for prod. Prefer separate clients and
   secrets per environment. Confirm Workspace MFA enforcement.
2. Through the approved secret-management process, create a Secrets Manager JSON
   secret in **us-east-2** containing `google_client_id`, `google_client_secret`,
   `grafana_secret_key`, and `otlp_token`. Generate independent cryptographically
   random values of at least 32 characters for the last two. Preserve
   `grafana_secret_key` through recovery; changing it can make stored credentials
   unreadable. Never paste secret values into shell commands, this file or PRs.
3. Select approved users and admins. Select an existing **us-east-2** SNS topic
   with a confirmed, monitored subscription for infrastructure alarms. Its
   delivery destination must remain accessible during a production outage.
   Configuration rejects secrets and topics in another region; the host reads
   the local secret directly, without fetching credentials from production.
4. Build, publish and smoke-boot the NixOS image as described below. Set its
   reviewed Ohio AMI ID; there is deliberately no mutable "latest image" lookup.
5. Set the nonsecret configuration below, substituting actual identifiers. No
   example account or placeholder is authorized automatically.

```bash
\cd infra
bun install --frozen-lockfile
\cd stacks/observability
pulumi stack select macro-inc/dev --create
pulumi config set aws:region us-east-2
pulumi config set amiId '<reviewed NixOS AMI ID in Ohio>'
pulumi config set secretArn '<existing Secrets Manager ARN>'
pulumi config set alarmTopicArn '<existing monitored SNS topic ARN>'
pulumi config set --path 'allowedEmails[0]' '<approved-admin@macro.com>'
pulumi config set --path 'allowedEmails[1]' '<approved-viewer@macro.com>'
pulumi config set --path 'adminEmails[0]' '<approved-admin@macro.com>'
pulumi preview --diff
```

Deploy with `pulumi up` after
reviewing the resource plan. Allow up to 15 minutes for bootstrap/image pulls.
Pulumi resource creation does not prove bootstrap or OAuth has succeeded.
Do not change the region of a stack that already owns resources: that requires
an explicit migration and recovery plan for its protected storage.

Before enabling application traffic, validate all of these against AWS:

- Approved Viewer and Admin can log in; an unapproved Workspace account and a
  personal Google account cannot. Viewer cannot administer Grafana.
- All three data sources pass their health checks. A small OTLP fixture appears
  in logs, traces and metrics with the expected `service.name`.
- Missing/wrong tokens fail; valid token cannot read backend APIs. No backend
  ports or SSH are reachable directly.
- S3 objects appear after flushing; IAM uses the expected two buckets only.
- Reboot preserves data and starts services; stop/replace the host and verify
  the existing volume is reattached. Restore a snapshot to an isolated host and
  verify SQLite/Prometheus/WAL recovery before relying on the backup.
- Host/container metrics and Docker/systemd logs appear in Grafana. CloudWatch's
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
not simulated by the local Docker tests.

For host changes or security updates, update `nixos/host.nix` or the pinned input
with `nix flake update nixpkgs`, build/test/publish a new image, then change `amiId`
and review `pulumi preview`. Do not run an ad-hoc `nixos-rebuild switch` on the
host: Pulumi's pinned image is the source of truth. Rolling back an AMI does not
roll back Grafana schema migrations or telemetry state; use a tested snapshot
recovery plan when the old application version cannot read current data.

### Runtime

Use SSM Session Manager with the `instanceId` output. On the host:

```bash
sudo systemctl status observability
sudo journalctl -u observability -u alloy -u amazon-cloudwatch-agent --since '30 minutes ago'
sudo journalctl -u docker --since boot
sudo docker compose -f /opt/observability/compose.json ps
sudo docker compose -f /opt/observability/compose.json logs --tail 100
```

Nonsecret runtime values are delivered as versioned, compressed JSON in EC2
user-data. NixOS reads them using IMDSv2 and validates the exact schema, region,
hostnames, bucket/volume/secret identifiers and identity lists before rendering
anything. The standard NixOS user-data evaluator is disabled. Host services,
helper scripts and all application templates are baked into the AMI. Schema
version 3 rejects older payloads, unknown settings and caller-supplied files.
The renderer parses JSON before substituting values, so the Grafana role
expression cannot alter the container definition's structure. Rendered files
are written to `/opt/observability` before Docker starts. Configuration/image
changes require a new image and reviewed `amiId`; runtime value changes do not
need an image rebuild. Both kinds of changes (including allowlists or image
versions) replace the instance and cause downtime. The old
instance is deleted before replacement, its data volume is cleanly detached,
then the new host waits for that exact volume. Bootstrap formats only a disk with
no filesystem/signatures. Both Docker and the stack service refuse to start if
the data mount is missing, preventing silent writes to the root disk.

Container `on-failure` policies restart crashed processes but leave host/daemon
startup to systemd. The stack service fetches secrets before creating containers
and retries every 30 seconds without exhausting a start limit during a secret
service outage. `PartOf=docker.service` restarts the stack after a Docker service
restart. Docker itself does not depend on Secrets Manager availability. Its
pre-start step fetches nonsecret metadata and mounts/verifies the exact EBS disk;
attachment and metadata failures retry without exhausting Docker's start limit.
Docker's `Upholds` relationship starts the stack after a delayed Docker recovery.

Secrets are fetched on every boot and service restart. To rotate the OAuth secret
or ingestion token, update the Secrets Manager value, then run `sudo systemctl
restart observability`. This briefly stops ingestion and Grafana. For token
rotation coordinate producer configuration and use its retry queue; there is no
dual-token grace window yet. Do not casually rotate the Grafana encryption key.

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

## Validation and subsequent passes

From `infra/`:

```bash
bun test stacks/observability/render.test.ts
OBSERVABILITY_SMOKE=1 bun test stacks/observability/render.test.ts
# Also run native agents: requires passwordless sudo for the isolated Alloy process.
OBSERVABILITY_SMOKE=1 OBSERVABILITY_COLLECTORS=1 bun test stacks/observability/render.test.ts
# Optional: requires Nix and a user systemd manager; never restarts real Docker.
OBSERVABILITY_SYSTEMD=1 bun test stacks/observability/render.test.ts
bunx biome check stacks/observability
bun run check
```

Build the NixOS image from this stack directory with `nix build . --cores 2`.
The systemd test evaluates the actual units from the pinned NixOS configuration.

The opt-in test requires Nix and builds the same `application-config` output used
by the AMI. It creates and removes its own Docker project, temporary directories
and LocalStack S3. It uses fake credentials and loopback-only ephemeral ports. It
checks real container startup, Google authorization redirect/PKCE, role mapping,
unauthenticated access denial, token validation, ingestion-only routing,
three-signal readback, S3 writes and backend restart recovery. It then enables
auth.proxy only in the local fixture to exercise an authenticated Viewer: all
three data-source health checks and queries succeed, while backend maintenance
and write endpoints are denied. Production auth.proxy is never enabled.

The collectors opt-in builds the exact Nix agent packages/configuration. It runs
native Alloy against the fixture's containers and a generated journal file,
checks host and container metrics plus Docker/journal log readback, and runs
CloudWatch Agent against fake IMDS and a local CloudWatch API receiver. It verifies the emitted alarm
metric dimensions and that a missing mount never reports fallback root usage.
Only this fixture's Alloy process runs with sudo; it does not start host services
or restart Docker. Agent state and test containers are removed afterward.

IMDS tests reject unexpected schema versions, setting keys, caller-supplied files,
invalid identifiers, identity lists and regions before writing configuration;
they also verify safe JSON substitution. Disk preparation tests substitute every
disk utility and confirm that failed inspection cannot trigger formatting. The optional systemd test uses isolated
transient user units and stand-in processes to test secret-outage recovery and
daemon restart/crash recovery. It does not restart the machine or real Docker.
Real Google login, AWS IAM, EC2 block-device attachment and boot, ALB/TLS and
snapshot restore remain deployment acceptance checks above.

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
