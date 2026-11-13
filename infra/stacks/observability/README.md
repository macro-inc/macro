# Observability pilot

## CI telemetry

`tooling/xtask/crates/xtask_workflows/src/workflows/export_ci_telemetry.rs` defines
this workflow. Run `cargo x workflows` to regenerate
`.github/workflows/export-ci-telemetry.yml`; CI checks it for drift. The JavaScript
preflight, TypeScript event steps and shell credential reader are embedded from
adjacent `scripts/` files at generation time, so runtime checkout is unnecessary.

The generated workflow observes completed workflows on its
explicit name list using Grafana's
[`gha-otel-export`](https://github.com/grafana/grafana-github-actions/tree/b1c422726cc4ff4adb0838ebca67586f24babb42/gha-otel-export)
action, pinned to that reviewed commit. It reads the triggering attempt's GitHub
metadata and sends OTLP/HTTP protobuf traces to our existing endpoint. The trace
hierarchy is workflow → jobs → steps, stored in Tempo with
`service.name=github-actions` and `deployment.environment=ci`. There is no
triggering PR checkout, artifact download, raw build-log collection, or Datadog
export. Individual test cases are outside this integration.

### CI events in Loki

Tempo refuses metrics queries over three hours and keeps traces for seven days, so
it cannot answer daily percentiles. The exporter therefore also writes one log line
per finished push, job and step to Loki, with `service_name="ci-telemetry"`. They
keep for 30 days and give exact percentiles. Fields are structured metadata, read
without a parser; each line's `trace_id` links to the run's trace.

| `event` | Fields |
| --- | --- |
| `push` | `pr_type`, `wall_seconds`, `wall_start`, `start_lag_seconds`, `conclusion`, `last_workflow`, `last_job`, `slowest_job`, `queue_max_seconds`, `cold_volumes`, `files_changed`, `rust_crates_changed`, `experiment`, `rerun`, `pr_draft` |
| `job` | `workflow`, `job`, `conclusion`, `run_seconds`, `queue_seconds`, `runner_profile`, `volume_state`, `dev_shell_seconds` |
| `step` | `workflow`, `job`, `step`, `conclusion`, `run_seconds` |
| `export` | The exporter's own cost: `collect_seconds`, `api_calls`, `rate_remaining`, `rate_limit` |

`pr_type` is `web`, `rust-small`, `rust-medium`, `rust-large`, `mixed`, `infra`,
`other` or `unknown`. Rust size counts changed crates: up to 2, up to 9, then large,
or any root manifest change. `wall_seconds` runs from the push, or from opening the
PR when that came later, to the last job. If neither fits, such as a reopen or
leaving draft, it runs from the first workflow run and `wall_start` says
`first_run`. A push counts as finished when every workflow it started has finished,
so a workflow a PR runs must be on the exporter's list; a test enforces this. A run
that starts after everything on its head has finished came from something else, such
as a PR edit, a label or leaving draft. It forms its own line with `rerun=true`,
which also leaves a commit's first full run after draft out of the real PR numbers.

Real PR numbers exclude experiments, reruns and drafts, and pushes where only one
workflow ran: a lone CLA run means CI didn't run, as on a PR into another branch.
Metadata makes an ungrouped query return one series per combination, so always group:

```logql
quantile_over_time(0.9, {service_name="ci-telemetry"} | event="push"
  | experiment="false" | rerun="false" | pr_draft="false" | conclusion="success"
  | workflows > 1 | unwrap wall_seconds [1d]) by (pr_type)
```

Lines never carry branch names, actors, titles or file paths. A line's time and
body are the same from every exporter that sees it, so Loki drops the duplicate
when two workflows finish together. A workflow that starts after the rest finished
produces a second `push` line for that head. `volume_state` is `cold` when the dev
shell step takes 30 s or more, an inference from step timing.

Collection and sending are best effort and cannot fail the exporter, and neither
touches the observed PR's jobs. Collection runs before any credential is read.

`nixos/ci-report.json` holds the queries over these events: real PR wall time
overall and by PR type, what finished last, the slowest PR jobs and steps, queue
by runner and job, warm and cold cache volumes, CI hours by trigger, and the
exporter's own cost. The top of `/d/macro-ci` renders them over the selected
range, and the daily report prints the same tables as Markdown, plus one summary
row per UTC day:

```sh
GRAFANA_TOKEN=$(cat <token file>) bun infra/stacks/observability/scripts/ci-report.ts --range 24h --days 7
```

The token needs only Viewer access. `--loki <url>` points it at another Loki API
root, such as a local one. Change a query in the JSON and both follow. PR steps
grouped by workflow, job and step pass Loki's default cap of 500 series in a day,
so `backend-config.nix` raises `max_query_series` to 2000.

Below them, `/d/macro-ci` provides workflow traces, failed/cancelled jobs and steps, and jobs
running longer than five minutes. Open a trace for its execution waterfall and
GitHub URL. Search tables are limited to 100 traces and 100 matching spans per
trace; narrow the time range to investigate further. These are bounded searches,
not complete counts or p95 summaries. Job durations exclude runner queue time. Workflow root duration
includes waiting and, on reruns, starts at the original run creation time because
of an upstream limitation; do not treat it as attempt execution time.

### run_local events in Loki

`just run_local`, `just stack up`/`update` and `cargo x build-services` send the
same kind of events by default, unless a developer opts out
(`docs/development/running-locally.md`, `tooling/xtask/crates/xtask_local_telemetry`):
one line per run, step, build and container health wait, with
`service_name="local-telemetry"` and `deployment_environment="local"`, through
the same OTLP route as CI. Each machine reads the ingest token from Doppler
`observability/lcl` (`LOCAL_TELEMETRY_TOKEN`) into a 0600 per-user file; keep
that config holding only this ingest-only token, since every engineer can read it. Fields are structured metadata; each line's
`trace_id` opens the run's step waterfall in Tempo. Runs that ended before their
events were sent are sent by the developer's next run, clamped to 30 minutes old
like CI's, and a killed run arrives with `outcome="interrupted"`.

| `event` | Fields |
| --- | --- |
| every line | `run_id`, `kind` (`up`, `rebuild`, `stop`, `restart_frontend`, `stack_up`, `stack_update`, `build_services`), `detached`, `instance` (hashed unless `default`), `instance_kind` (both absent for `build_services`), `host` (hashed), `host_name` (the readable machine name, only from machines with `services = true`), `platform`, `cpus`, `worktree` (hashed), `git_sha`, `branch` (hashed unless `main`) |
| `run` | `seconds` (for `up`: first step to a backend answering through the proxy with Vite started), `outcome` (`success`, `failure`, `interrupted`), `failed_step`, `mode`, `start` (`fresh`, `resume`), `vite`, `static_frontend`, `steps` |
| `step` | `step`, `seconds`, `outcome`, plus the run's `mode` and `start` |
| `build` | `step`, `seconds`, `outcome`, `units_compiled`, `workspace_units_compiled`, `sccache_requests`, `sccache_hits`, `sccache_misses` (server-wide during the build) |
| `service` | `service`, `phase` (`infra`, `app`), `health`, `seconds_to_healthy` (start to first passing probe), `restarts` |

```logql
quantile_over_time(0.9, {service_name="local-telemetry"} | event="step" | kind="up"
  | unwrap seconds | __error__="" [7d]) by (step)
```

`nixos/local-report.json` holds the queries for the `Macro run_local` dashboard
(`/d/macro-run-local`) and for `scripts/ci-report.ts --spec local`. Both
dashboards build their Loki panels with `nixos/loki-report-panels.nix`.

### Local stacks' own telemetry

A developer who sets `services = true` in their local telemetry settings also
sends their local stacks' service traces, logs and metrics through the same
route and token (`docs/development/running-locally.md`). A Grafana Alloy
forwarder on their machine (`docker/grafana-forwarder/config.alloy`) keeps every
trace with an error in its first 30 seconds and a tenth of the rest, drops the
local collector's own telemetry and debug and trace logs,
and tags resources and metric datapoints with `host.name` (the machine's name)
and `deployment.environment="local"`; services add `macro.local.instance`. Dev
dashboards and alerts select `dev`/`development`, so this data stays out of
them. In Loki, `host_name` and `macro_local_instance` are structured metadata,
under `deployment_environment="local"`. The `Macro run_local` dashboard's
`Machine` variable lists `host_name` from those metrics, and its last row
(`nixos/local-dashboard.nix`, not the shared report spec) shows bring-ups,
stacks, sampled traces, error logs and logs by machine.

### Pinned exporter limits

A small metadata preflight rejects runs that the upstream action cannot export
reliably: more than 100 jobs, 512 or more total workflow/job/step spans, colliding
name-derived span IDs, or unavailable/invalid job or step timestamps. The action
only fetches its first jobs page; its automatic batch export can swallow delivery
errors at 512 spans. These guards catch those known cases before export.
Skipped/cancelled jobs are included when GitHub supplies their timestamps; those
without timing cause a visible exporter failure. Zero-job attempts are skipped
with a notice. Remove limits only after upgrading and verifying the upstream fix.

Deploy the prod Pulumi stack before enabling the workflow: it creates the account's
GitHub OIDC provider and `macro-observability-ci` role, restricted to this repository's
`main` identity and reading only `observability/dev-ingest` from Secrets Manager.
There are no stored AWS access keys in this workflow. `ciIngestSecretArn` must match
that existing Virginia secret. The bearer token is masked and passed only to the
export step. The role can submit telemetry but cannot read stored traces or obtain
Grafana's OAuth credentials. The provider is account-wide and protected; import it
into Pulumi if another stack creates it before this rollout.

Deploy the host (see [Deploying](#deploying)) to provision the dashboard. The workflow starts observing after
merge to `main`; add new workflow names to its list when they are introduced.
GitHub's three-level `workflow_run` chaining limit still applies. Keep
`trace-artifacts-glob` unset so the exporter never downloads PR-produced artifacts.

Exporter failures appear as failed **Export CI telemetry** runs and do not change
the observed workflow's result. Retry transient failures after GitHub finalizes job
metadata. Deterministic trace IDs allow lookup across retries, but delivery is not
transactional or guaranteed exactly once. Old spans are subject to Tempo's ingestion
and retention limits. This is completion-time collection, with no live job progress,
historical backfill, or CI alert notifications. Validate a successful and failed
workflow, a rerun, and a multi-job trace after rollout before relying on the dashboard.

This stack starts Grafana alongside Datadog on one private EC2 instance. It
runs Grafana, Loki, Tempo, Prometheus, Alloy, nginx and the GoAlert on-call
pager (with its own Postgres) as native systemd services
on a prebuilt NixOS image. There is no Docker or Compose dependency. Nix owns
packages, configuration, service users, resource limits and startup dependencies:

- `nixos/services.nix`: native application services and runtime credentials.
- `nixos/grafana.nix` and `nixos/datasources.nix`: Grafana access policy and datasources.
- `nixos/backend-config.nix`: Loki, Tempo and Prometheus settings.
- `nixos/ingest.alloy`: unprivileged OTLP receiver and export pipeline.
- `nixos/host-telemetry.nix` and `nixos/host.alloy`: host metrics and journal logs.
- `nixos/cloudwatch.nix`: independent disk and memory health metrics.
- `nixos/proxy.nix`: native nginx virtual hosts and query-only backend gateway.
- `nixos/goalert.nix` and `nixos/goalert/`: GoAlert, its Postgres, backups and
  the Macro Alerts relay (see [On-call paging](#on-call-paging-goalert)).
- `nixos/alerting.nix`: Grafana alert rules, contact points and routing.
- `nixos/prod-alerts.nix`: prod alert queries and thresholds, shared by the
  rules and `nixos/prod-alerts-dashboard.nix`.
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
Datadog, on-call browsers -- HTTPS --> ALB --> nginx --> GoAlert --> Postgres --> EBS
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
  dashboards and settings, not log/trace/metric history. GoAlert's schedules,
  users and alerts live in a local Postgres 17 on the same volume.
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

The stack is deliberately absent from `.github/services-config.json`; it deploys
only through the manual workflow in [Deploying](#deploying). Use the repository's Pulumi backend
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
   `grafana_secret_key`, and `otlp_token`, plus the GoAlert fields listed under
   [On-call paging](#on-call-paging-goalert). Generate independent cryptographically
   random values of at least 32 characters for `grafana_secret_key`, `otlp_token`
   and `goalert_encryption_key`. Preserve `grafana_secret_key` and
   `goalert_encryption_key` through recovery; changing them makes stored
   credentials unreadable. Never paste secret values into shell commands, this
   file or PRs.
3. Select an existing **us-east-2** SNS topic
   with a confirmed, monitored subscription for infrastructure alarms. Its
   delivery destination must remain accessible during a production outage.
   Configuration rejects secrets and topics in another region; the host reads
   the local secret directly, without fetching credentials from production.
4. Build, publish and smoke-boot the NixOS image: run **Deploy Observability**
   as a dry run (see [Deploying](#deploying)). Pulumi finds the AMI tagged for
   this checkout's image source; there is no `amiId` setting.
5. Set the nonsecret configuration below, substituting actual identifiers.
   Placeholder credentials are not usable for deployment.

```bash
\cd infra
bun install --frozen-lockfile
\cd stacks/observability
pulumi stack select macro-inc/dev --create
pulumi config set aws:region us-east-2
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

### Deploying

Run **Deploy Observability** (`.github/workflows/deploy-observability.yml`,
generated from `tooling/xtask/crates/xtask_workflows/src/workflows/deploy_observability.rs`)
from `main` in the Actions tab. Nothing starts it automatically.

> **A rollout causes downtime.** It replaces the single host: Grafana, Loki,
> Tempo, Prometheus and GoAlert are unavailable, and OTLP ingestion is refused,
> for several minutes, until the new host passes its load-balancer health checks.
> Producers retry rejected OTLP requests; pages from Datadog to GoAlert fail
> during the window. Run it when that is acceptable.

The `dry_run` input defaults to on. A dry run does everything except replace
the host: build, publish, smoke boot, preview and the permission check. Untick it
to roll out. The steps, all in `deploy/release.ts`:

1. **Refuse a stale commit.** Branches other than `main`, and a re-run of an old
   run whose commit is behind main's last change to this stack, fail, so a rerun
   never rolls production back.
2. **Find the image.** `deploy/image-key.ts` hashes the image's source (the
   git-tracked `flake.nix`, `flake.lock`, `nixos/` and `assets/`, minus
   `nixos/database-collector/`). An available AMI with the tag key
   `ImageSource:<hash>` has already passed a smoke boot for this source: skip to
   step 5. Otherwise, if an AMI already boots the same NixOS system
   (`NixSystem` tag, from `nix eval` of the toplevel) and passed, it gets this
   source's tag and the host is not replaced. If one exists but has not passed,
   go to step 4.
3. **Build and publish.** `nix build .` makes the UEFI VHD (its builder needs the
   `kvm` system feature; without `/dev/kvm` QEMU emulates, more slowly).
   `deploy/publish.ts` uploads it to `macro-observability-images-569036502058-us-east-2`,
   imports an encrypted snapshot through the `macro-observability-vmimport` role
   and registers a private AMI tagged `project`, `ImageSHA256`, `NixSystem` and
   `GitCommit`. A rerun reuses an AMI or import task for the same VHD.
4. **Smoke boot.** `deploy/smoke.ts` creates this run's own resources, named
   after the run: two buckets (`observability-smoke-<run>-logs` and `-traces`),
   a secret `observability/smoke-<run>` of fresh throwaway values, and an IAM
   role and instance profile under the path `/observability-smoke/` that may
   only reach those buckets and that secret, plus SSM. It launches the AMI as an
   `m7i.xlarge` in the host's subnet and security group with a blank 20 GiB
   volume. Never production storage: Loki and Tempo compactors delete blocks they
   consider expired. The smoke host has no CloudWatch, SNS or production access,
   and its alarm topic does not exist, so it cannot page anyone. Over SSM it waits up to 15 minutes for every unit to be
   active and for `/healthz`, `/goalert-healthz`, Loki, Tempo and Prometheus to
   answer, then sends an OTLP log and span and finds them in Loki and Tempo, and
   checks ingestion refuses a missing token. Cleanup stops the host, detaches and
   terminates it (the calls a rollout makes), then deletes the volume, buckets,
   secret, instance profile and role. It sweeps every smoke resource, not only
   this run's, so a cancelled or crashed run's leftovers go too, and a cleanup
   that cannot delete something fails the run. A pass
   tags the AMI `Smoke=passed` and `ImageSource:<hash>`; a failure tags
   `Smoke=failed`, prints the failing units' journals and the console, and stops
   the run with production untouched.
5. **Check the plan.** `pulumi preview --json --show-sames` on `prod`;
   `deploy/plan.ts` allows only replacing or updating the instance, its volume and
   target-group attachments, and updating the alarms that name it. Any other
   change (network, IAM, DNS, buckets, the data volume) stops the run: apply it
   with a reviewed manual `pulumi up`. The data volume and both buckets must be
   listed unchanged. Then `deploy/iam-preflight.ts` runs IAM's policy simulator
   for every call the replacement makes, on the stack's real ARNs, so a missing
   permission fails here instead of after the old host is gone.
6. **Roll out** (not in a dry run). `pulumi up --target <instance> --target-dependents`,
   so nothing else changes even if the stack moved since the preview. Then it waits
   up to 25 minutes for the new instance to pass both target groups' health
   checks and for `https://grafana.macro-internal.com/api/health`, and prints how
   long the update took.

One rollout runs at a time (concurrency group `deploy-observability-prod`,
never cancelled). When a pull request changes the image, `PR CI` (the `run-ci`
label) builds it through `.github/workflows/observability_image.yml`, with no
credentials, so a broken image fails before merge. The deploy job uses the
repository's deploy credentials (`AWS_ACCESS_KEY`, `AWS_SECRET_ACCESS_KEY` and
`PULUMI_ACCESS_TOKEN`), the same ones `deploy_on_push` and `deploy_web_app` use.
Nothing needs setting up first.

**If the new host fails after the rollout.** The old instance is already gone:
the stack deletes it before creating the replacement, since one host owns the
data volume. The run fails loudly; follow [Runtime](#runtime) to debug over SSM.
To roll back, revert the commit on `main` and run the workflow again: the
previous source's AMI still carries its tag, so nothing is rebuilt. Rolling an
AMI back does not roll back Grafana or GoAlert schema migrations; use a tested
snapshot recovery when the old version cannot read current data.

**What survives a replacement.** Nothing the services keep is on the replaced
host:

- Loki chunks and Tempo blocks are in the two S3 buckets, which Pulumi protects
  and retains (`durable`), and nothing about them depends on the image.
- Everything local is on the `observability-data` EBS volume: Grafana's SQLite
  (users, dashboards, settings), Loki and Tempo WALs and indexes, Prometheus
  TSDB, Alloy's WAL and GoAlert's Postgres. The volume is protected and retained,
  and none of its inputs change with the image, so the plan check requires it to
  be unchanged.
- Only the volume attachment is replaced. It has `stopInstanceBeforeDetaching`,
  so the old host stops cleanly (systemd gives each service 90 seconds) before
  the detach, and `forceDetach: false`.
- The new host's bootstrap waits for that exact volume ID, mounts it without
  formatting (`prepare-volume.sh` formats only a disk with no filesystem or
  signatures), and stable uids keep file ownership. Every service checks the
  mount before starting, so none falls back to the root disk.
- The root disk is disposable and holds nothing to keep. OTLP data accepted
  into Alloy's in-memory queues during shutdown can be lost; producer retries
  cover requests rejected while the host is down.

**Images and cleanup.** Retain the previous AMI and snapshot until the new host
has passed acceptance; the workflow never deletes AMIs. Remove obsolete image
artifacts, AMIs and their root snapshots through the normal infrastructure
cleanup process; they are separate from the protected telemetry volume and its
daily snapshots. Do not run an ad-hoc `nixos-rebuild switch` on the host: the
image built from `main` is the source of truth. For host changes or security
updates, update `nixos/host.nix` or the pinned input with
`nix flake update nixpkgs`, merge, then deploy.

**Prerequisites.** The image bucket and `macro-observability-vmimport` role
above, which earlier hand publishing created. Nothing persistent exists for the
smoke boot; each run creates and deletes its own resources.

To publish by hand, with credentials that may write the bucket and import:

```bash
\cd infra/stacks/observability
nix build . --cores 2
bun deploy/publish.ts result macro-observability-images-569036502058-us-east-2 --role macro-observability-vmimport
```

A hand-published AMI has no `ImageSource` or `NixSystem` tag, so neither Pulumi
nor the workflow's `find` step uses it. The workflow builds its own image; only
when that build produces a byte-identical VHD does `publish` reuse the
hand-published AMI (matched by `ImageSHA256`) and tag it.

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

Configuration/image changes require a new image; runtime value changes do not
need an image rebuild. Both kinds of changes replace the instance and cause
downtime (see [Deploying](#deploying)). The old instance is deleted before replacement, its
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
Profiles, production/full database-query parity, RUM/session replay, and complete
Datadog dashboard/monitor migration remain separate coverage work.

### Provisioned dashboards and alerts

Nix provisions the `Macro` dashboard folder, a dev telemetry dashboard, and a
CloudWatch database/Lambda dashboard. CloudWatch reads native metrics in Virginia;
it does not replicate their history to Ohio, so these panels depend on Virginia
remaining available. These are not a replacement for Datadog database query monitoring, RUM, or anomaly
models. Grafana uses the EC2 role for regional metric reads and publishing to the
configured alarm SNS topic. Other unprivileged HTTP/ingest services still cannot
access instance metadata.

`nixos/prod-alerts.nix` lists the prod CloudWatch alerts: macrodb memory, swap,
load, CPU, connections, replica lag, read latency and storage; Redis memory and
evictions; SQS queue age. Each entry holds its query, thresholds, window and
text once. `nixos/alerting.nix` turns each into a warning and a critical rule in
the `Prod` group, reading CloudWatch in Virginia directly, and
`nixos/prod-alerts-dashboard.nix` draws it as one panel with both thresholds on
the `Prod alerts` dashboard (`/d/prod-alerts`, rows macrodb, Redis and Queues).
Each rule carries its panel as `__dashboardUid__`/`__panelId__`, so the rule
view links to the graph of the metric that fired, and as a `panel_url`
annotation built from Grafana's `externalURL`, because GoAlert's alert details
list annotations but not Grafana's panel link. Each
has a Datadog copy in `infra/stacks/monitoring/monitors/`; keep thresholds and
windows in sync by hand. Forecasts, anomalies, Database Monitoring, APM and log
rules are Datadog-only.

Every prod alert goes to GoAlert over loopback, and GoAlert alone posts to the
Macro Alerts channel. Critical alerts of rules with `pages = true` go to the
`GoAlert` contact point (the paging `Grafana critical` service); every other prod
alert, warnings and non-paging criticals, goes to `GoAlert notify` (the `Notify`
service), which is also the default receiver. Grafana repeats critical alerts
hourly and others every four hours; GoAlert dedups them by fingerprint, opens,
acknowledges and closes the alert, and its escalation posts each change to the
channel (see [Escalation](#escalation)). The details GoAlert posts carry each
alert's labels and annotations (summary, description, runbook, panel) and its
Grafana source link. Paging rules' Datadog copies only notify, so an incident
pages once.

The dev rules below keep their own route to `Macro team email`.

The three dev monitors declared in the monitoring stack: DSS errors (1013923), channel-invite spam (4876245), and document text
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

User-data schema 6 adds `oncallHost`. Deploy it together with the image that
reads it; a schema-5 image cannot boot schema-6 user data.

## On-call paging (GoAlert)

GoAlert is the source of truth for open alerts and the only sender to the Macro
Alerts channel: Grafana sends it every prod alert, and on-call engineers acknowledge or close them in its UI at
`https://oncall.macro-internal.com`, signing in with Google. It runs on this host
so paging keeps working while production, its database or Macro itself is down.
Today it pages by posting to the Macro Alerts channel; phone paging (Twilio) and
a rotation are follow-ups. Coding agents reach it through the `goalert` MCP
server; see [MCP servers](../../../docs/development/mcp-servers.md#goalert).

- `nixos/goalert/package.nix` builds GoAlert from source with `buildGoModule`,
  embedding its web UI. Bump `version` and the hashes together.
- `nixos/goalert.nix` runs Postgres 17 on a Unix socket only (data in
  `/srv/observability/postgres`), and GoAlert on `127.0.0.1:3030`. Its
  application config is a Nix attrset. GoAlert stores that config only in its
  database, so `apply-config.py` migrates the schema, runs `goalert set-config`
  and creates the `admin` login before every start. Edits in GoAlert's admin
  config page are overwritten on the next restart. `set-config` stores invalid
  values without failing; GoAlert logs `validate config` errors when it loads
  them, so check the journal after changing config.
- A nightly timer dumps the database to `s3://<logs bucket>/goalert/`, one object
  per weekday. The dump goes to a file first, so a failed dump never replaces a
  good backup.
- GoAlert's escalation steps post to `services/bots/goalert-bot`, a Cloudflare
  Worker that posts each alert to Macro Alerts and threads acknowledgements,
  closes and reminders under it. GoAlert's webhook allow-list
  (`goalert.nix`) permits its URL; the secret path segment lives only in the
  escalation step. The loopback relay below stays allowed as a fallback target.
- `macro-alerts-relay` on `127.0.0.1:8090` turns GoAlert webhooks into Macro
  channel posts and adds the channel's bot token; GoAlert webhooks cannot set
  headers. Each post starts with `---`, then the page or notify marker and the
  title without Datadog's bracketed tags, the state, a one-sentence description,
  and `Acknowledge · Graph · Runbook` links. Status changes are one line.
  `goalert/test_macro_alerts_relay.py` pins the format.
- nginx serves `oncall.macro-internal.com` from a runtime server block. Only
  `/health`, `/api/v2/generic/incoming` and `/api/v2/heartbeat/` are reachable
  without a session (GoAlert checks the integration key); other inbound
  integrations return 404. The rest is GoAlert's UI behind its login.
- Login is Google OIDC with Grafana's OAuth client, whose redirect URIs include
  `https://oncall.macro-internal.com/api/v2/identity/providers/oidc/callback`.
  GoAlert cannot restrict OIDC to a domain, so that client must keep the
  Internal audience. The basic-auth `admin` login is the break-glass account.
- Every `@macro.com` account is a GoAlert admin from its first sign-in:
  `goalert/workspace-admins.sql` installs a trigger on GoAlert's `users` table
  on every start. Other accounts stay plain users.
- The ALB sends the on-call host to its own target group, health-checked at
  `/goalert-healthz`. Alarm `observability-goalert` publishes to `alarmTopicArn`
  when it fails, so a GoAlert outage is reported without GoAlert.

### Secrets

Doppler `observability/prd` is the source of truth; copy the values into the
us-east-2 Secrets Manager secret the host reads, under the lowercase names:
`goalert_encryption_key` (≥32 random characters), `goalert_admin_password`
(≥32 random characters, the `admin` login), `macro_alerts_webhook_url` (HTTPS)
and `macro_alerts_bot_token` (the Alerts channel's webhook and bot token).
`goalert_grafana_integration_key` (the `Grafana critical` Grafana key) and
`goalert_grafana_notify_integration_key` (the `Notify` Grafana key) are optional
until GoAlert has created them; without one, GoAlert rejects that contact
point's alerts with 401 and Grafana shows it as failing.

### First deployment

1. Add the secrets above, then deploy the host as usual. The
   certificate gains the on-call name, so Pulumi replaces the ACM certificate and
   updates the listener.
2. Sign in as `admin`. Create the escalation policies and services below, and a
   Grafana integration key on `Grafana critical` and on `Notify`. Put the keys in
   Doppler and the secret as `goalert_grafana_integration_key` and
   `goalert_grafana_notify_integration_key` and restart `observability-secrets`.
3. Send a test alert through the service and check that it reaches the channel
   and can be acknowledged and closed.

### Escalation

Both policies have one step, webhook `http://127.0.0.1:8090/goalert`. The
channel sees every new alert, acknowledgement and close. `Macro prod` repeats
its step 5 times every 60 minutes, so an unacknowledged page is posted again
hourly; `Macro notify` posts once, so warnings stay quiet after their first
post.

- Escalation policy `Macro prod` pages: services `Grafana critical` (Grafana's
  paging criticals) and `Datadog critical`.
- Escalation policy `Macro notify` only posts to the channel: service `Notify`
  (Grafana warnings and non-paging criticals).
- Acknowledge an alert to stop its escalation, close it when handled; Grafana
  closes it on recovery. To silence a whole service for a while, use its
  maintenance mode.

### Recovery

GoAlert's state is on the retained volume, so a replacement instance resumes it.
For a lost volume, restore the latest dump with
`pg_restore --clean -d goalert` before starting `goalert`, using the same
`goalert_encryption_key`.

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

## PostgreSQL query monitoring

The separate [dev database collector](../database-observability/README.md) sends
query statistics to Prometheus and normalized SQL/activity samples to Loki. Its
query dashboard at `/d/macro-postgres-queries` links from `/d/macro-postgres`.
Deploy the Ohio image with the authenticated POST-only `/loki/api/v1/push` route
before upgrading the collector. The route reuses the existing ingestion
credential and exposes no Loki query or administration APIs. SQL records are
sensitive and use Loki's existing retention/access controls. Database setup and
collector deployment are manual; merging the PR does not enable collection.

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
   production RDS/Postgres query parity and logs, browser RUM, synthetics,
   profiling and security features. They are not covered by duplicating OTLP.
   Extend the dev DB collector to production with dedicated read-only monitoring
   identities and evaluate query-level
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
