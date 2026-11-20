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

### GitHub API budget

Every workflow's `GITHUB_TOKEN` draws on one budget of 5,000 REST calls an hour
for the repository, and PR CI fails to start without its own calls. Exporting
every completion of about 50 workflows, most of them PR bookkeeping, once used
nearly all of it. So:

- PR bookkeeping that runs on most PR events (labels, statuses, comments, text
  checks, preview cleanup; the `UNOBSERVED_PR_WORKFLOWS` list) is not observed.
  It has no `job` or `step` lines or traces, so CI hours and the queue tables
  leave out its runs, most of the tiny runner's work among them. It seldom
  finishes last on a push that ran PR CI (2 of about 640 in a week). A test makes
  every new PR workflow pick a list.
- A run whose jobs were all skipped doesn't start the exporter.
- The preflight reads the budget first, which GitHub doesn't count. Below 40% of
  the limit it skips the export and makes no calls; the collector stops at the
  same line. Otherwise it lists the run's jobs once, for both the collector and
  its own checks of the upstream action's limits.
- The trace step runs only on an attempt the pinned trace action can represent.
  That action retries a failed assertion, and an API error, up to 240 times at
  two calls a try, and sends a job that ends before it starts as a broken span,
  so the preflight checks first. When it refuses, the exporter still ends green,
  without an annotation, and the `export` line's `untraced` says why. The
  common reason is `job_never_ran`: GitHub dates a skipped job, or one
  cancelled before it started, as completed a second before it started, and most
  PR CI runs skip some jobs. An API error during the trace can still start the
  retry loop.

An exporter run costs one call to list jobs, two for the trace, and, on a PR
event, one to list the head's runs. The run that completes a push adds one call
per other workflow that ran, one for the PR, one to three for its files and one
for the push time.

### CI events in Loki

Tempo refuses metrics queries over three hours and keeps traces for seven days, so
it cannot answer daily percentiles. The exporter therefore also writes one log line
per finished push, job and step to Loki, with `service_name="ci-telemetry"`. They
keep for 30 days and give exact percentiles. Fields are structured metadata, read
without a parser; each line's `trace_id` links to the run's trace, which exists
only when the run's `export` line has no `untraced`.

| `event` | Fields |
| --- | --- |
| `push` | `pr_type`, `wall_seconds`, `wall_start`, `start_lag_seconds`, `conclusion`, `last_workflow`, `last_job`, `slowest_job`, `queue_max_seconds`, `cold_volumes`, `files_changed`, `rust_crates_changed`, `experiment`, `rerun`, `pr_draft` |
| `job` | `workflow`, `job`, `conclusion`, `run_seconds`, `queue_seconds`, `runner_profile`, `volume_state`, `dev_shell_seconds` |
| `step` | `workflow`, `job`, `step`, `conclusion`, `run_seconds` |
| `export` | The exporter's own cost: `collect_seconds`, `api_calls` (the run's GitHub calls: the preflight's, the collector's, and two for a trace the preflight passed, not counting the trace action's retries), `rate_remaining`, `rate_limit`, `skipped` (`budget`, `no_listing`) when it made no calls, and `untraced` when it sent no trace (`no_job_ran`, `job_never_ran`, `job_unfinished`, `no_conclusion`, `step_timing`, `duplicate_name`, `over_100_jobs`, `over_511_spans`) |

`pr_type` is `web`, `rust-small`, `rust-medium`, `rust-large`, `mixed`, `infra`,
`other` or `unknown`. Rust size counts changed crates: up to 2, up to 9, then large,
or any root manifest change. `wall_seconds` runs from the push, or from opening the
PR when that came later, to the last job. If neither fits, such as a reopen or
leaving draft, it runs from the first workflow run and `wall_start` says
`first_run`. A push counts as finished when every workflow it started has finished,
and only an observed workflow's completion can notice that, so a push whose last
workflow is unobserved PR bookkeeping has no `push` line. Neither does a push
where only bookkeeping ran, or only one workflow. A run
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

`nixos/grafana-provisioning/ci-report.json` holds the queries over these events:
real PR wall time overall and by PR type, what finished last, the slowest PR jobs
and steps, queue
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
that config holding only this ingest-only token, since every engineer can read it. Fields are structured metadata; a run's
`trace_id` is its `run_id` and opens its waterfall in Tempo: steps nest under the
step they ran in, crates under the build, and every span carries `run_id`. Runs that ended before their
events were sent are sent by the developer's next run, clamped to 30 minutes old
like CI's, and a killed run arrives with `outcome="interrupted"`, as do the steps
it had open, which carry only `step` and `outcome`.

| `event` | Fields |
| --- | --- |
| every line | `run_id`, `kind` (`up`, `rebuild`, `stop`, `restart_frontend`, `stack_up`, `stack_update`, `build_services`), `detached`, `instance` (hashed unless `default`), `instance_kind` (both absent for `build_services`), `host` (hashed), `host_name` (the readable machine name, only from machines with `services = true` or a `machine` setting), `machine` (`host_name`, else `host`: group machines by this), `platform`, `cpus`, `memory_gb`, `cpu_model`, `worktree` (hashed), `git_sha`, `branch` (hashed unless `main`) |
| `run` | `seconds` (for `up`: first step to a backend answering through the proxy with Vite started), `outcome` (`success`, `failure`, `interrupted`), `failed_step`, `mode`, `start` (`fresh`, `resume`), `vite`, `static_frontend`, `steps`, `bring_up` (`<start>/<run_id>/<machine>`, on bring-ups that got ready: the dashboard's run pickers list it) |
| `step` | `step`, `seconds`, `outcome`, `offset_in_run` (seconds from the run's start to the step's), `lane` (`main` for the bring-up's own thread, whose top-level steps add up to its time to ready, or a background lane: `frontend`, `fusionauth`, `localstack`), `parent_step` (the step it ran inside, if any), plus the run's `mode` and `start` |
| `build` | `step`, `seconds`, `outcome`, `units_compiled`, `workspace_units_compiled`, `sccache_requests`, `sccache_hits`, `sccache_misses` (server-wide during the build) |
| `service` | `service`, `phase` (`infra`, `app`), `health`, `seconds_to_healthy` (start to first passing probe), `restarts`, `lane` (`containers`), `offset_in_run` (when the container started during the run) |
| `crate` | `crate`, `target` (`lib`, `bin`, `build-script`, `build-script-run`, ...), `workspace` (one of ours), `seconds`, `offset_in_build`, `step`, `lane` (`cargo`): a build's compilation units of at least 1 s, at most 150, from `cargo build --timings` |

```logql
quantile_over_time(0.9, {service_name="local-telemetry"} | event="step" | kind="up"
  | unwrap seconds | __error__="" [7d]) by (step)
```

`nixos/grafana-provisioning/local-report.json` holds the queries for the
`Macro run_local` dashboard (`/d/macro-run-local`) and for
`scripts/ci-report.ts --spec local`. Both dashboards build their Loki panels
with `nixos/grafana-provisioning/loki-report-panels.nix`. Every filter names the machine (`machine`, else `host_name`, else `host`, for events
recorded before `machine` existed), and the dashboard narrows each filter to
its `Machine` variable, which lists Tempo's `span.machine` values. Its rows:

- **Time to ready**: runs, percentiles, and the step with the biggest share of
  fresh and resumed bring-ups' critical path.
- **One bring-up as a trace**: the latest fresh start and resume that got
  ready, picked from Tempo's `span.bring_up` values (the Tempo data source
  reads tag values over 7 days, `timeRangeForTags`), and recent bring-ups whose
  trace ids open their trace.
- **Bottleneck**: a Gantt chart of each top-level step's median start
  (`offset_in_run`) and length, and the critical path: the `main` lane's
  top-level steps, which the bring-up waits on in order, by share.
- **Machines**: per machine percentiles, ready share, build time, sccache hits,
  CPUs and memory, and each step's median by machine.
- **Inside the steps**: every step, nested steps, the slowest crates, services,
  builds and actions.

Older events have no lanes or offsets, so the Gantt chart and critical path
cover only runs recorded since; the other panels cover every event.

### Local stacks' own telemetry

A developer who sets `services = true` in their local telemetry settings also
sends their local stacks' service traces, logs and metrics through the same
route and token (`docs/development/running-locally.md`). A Grafana Alloy
forwarder on their machine (`docker/grafana-forwarder/config.alloy`) keeps every
trace with an error in its first 30 seconds and a tenth of the rest, drops the
local collector's own telemetry and debug and trace logs,
and tags resources and metric datapoints with `host.name` (the machine's name)
and `deployment.environment="local"`; services add `macro.local.instance`,
which the forwarder copies onto metric datapoints. Dev
dashboards and alerts select `dev`/`development`, so this data stays out of
them. In Loki, `host_name` and `macro_local_instance` are structured metadata,
under `deployment_environment="local"`. The `Macro run_local` dashboard's last row
(`nixos/grafana-provisioning/local-dashboard.nix`, not the shared report spec)
shows bring-ups, stacks, sampled traces, error logs and logs by machine.

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

The cluster's Grafana provisions the dashboard. The workflow starts observing after
merge to `main`; a test fails until a new PR workflow is in `OBSERVED_WORKFLOWS`
or `UNOBSERVED_PR_WORKFLOWS`. Add other new workflows to `OBSERVED_WORKFLOWS`.
GitHub's three-level `workflow_run` chaining limit still applies. Keep
`trace-artifacts-glob` unset so the exporter never downloads PR-produced artifacts.

Exporter failures appear as failed **Export CI telemetry** runs and do not change
the observed workflow's result. Retry transient failures after GitHub finalizes job
metadata. Deterministic trace IDs allow lookup across retries, but delivery is not
transactional or guaranteed exactly once. Old spans are subject to Tempo's ingestion
and retention limits. This is completion-time collection, with no live job progress,
historical backfill, or CI alert notifications. Validate a successful and failed
workflow, a rerun, and a multi-job trace after rollout before relying on the dashboard.

## The host

This stack runs the GoAlert on-call pager on one private EC2 instance in Ohio,
separate from production in `us-east-1`, so paging keeps working while
production, its database or Macro itself is down. Grafana, Loki, Tempo, Mimir
and OTLP ingest run in the observability EKS cluster
(`infra/k8s/observability`). This stack still owns what they sit behind: the
ALB, its certificate and DNS, and the two buckets the cluster's Loki and Tempo
write.

The host runs GoAlert with its own Postgres, nginx for
`oncall.macro-internal.com`, the Macro Alerts relay, and Alloy and the
CloudWatch agent for its own health, as native systemd services on a prebuilt
NixOS image. There is no Docker or Compose dependency. Nix owns packages,
configuration, service users, resource limits and startup dependencies:

- `nixos/host.nix`: boot dependencies, retained storage, stable service
  identities and hardening.
- `nixos/goalert.nix` and `nixos/goalert/`: GoAlert, its Postgres, backups and
  the Macro Alerts relay (see [On-call paging](#on-call-paging-goalert)).
- `nixos/proxy.nix`: nginx, the ALB's only target on the host.
- `nixos/host-telemetry.nix` and `nixos/host.alloy`: host metrics and journal
  logs, sent to the cluster.
- `nixos/cloudwatch.nix`: independent disk and memory health metrics.

These sit under `nixos/` but only the cluster imports them. The image does not
read them, and `deploy/image-key.ts` leaves them out of its source:

- `nixos/grafana-provisioning/`: datasources, dashboards, alert rules, contact
  points and routing as plain Nix data (see
  [Provisioned dashboards and alerts](#provisioned-dashboards-and-alerts)).
- `nixos/grafana.nix`: Grafana's access policy.
- `nixos/backend-config.nix`: Loki, Tempo and Prometheus settings.
- `nixos/ingest.alloy`: the OTLP receiver and export pipeline.

Pulumi sends the host only validated runtime values such as hostnames and
bucket names.

## Architecture and storage

```text
Team browser -- HTTPS --> ALB --> observability EKS cluster (Grafana)
OTEL exporter -- HTTPS + bearer token --> ALB --> observability EKS cluster (ingest)
Host Alloy -- HTTPS + basic auth --> ALB --> observability EKS cluster (edge)
Datadog, cluster Grafana, on-call browsers -- HTTPS --> ALB --> nginx --> GoAlert --> Postgres --> EBS
```

The ALB sends `grafana.` and `otlp.macro-internal.com` to the cluster, whose
OpenTofu layer (`infra/k8s/observability/aws`) adds their listener rules on this
stack's HTTPS listener, and `oncall.macro-internal.com` to the host. Any other
name gets the listener's default 404.

- One `m7i.xlarge` (4 vCPU / 16 GiB) in a new VPC's private `us-east-2a`
  subnet in Ohio, separate from production in `us-east-1`.
- Independent regional dependencies: two public ALB subnets, one NAT gateway,
  a regional ACM certificate, EBS/snapshots, S3, Secrets Manager and alarm topic.
  An S3 gateway endpoint keeps bucket traffic off the NAT gateway. No production
  VPC, peering, NAT or regional certificate is reused. Route53 and IAM are global.
- Separate encrypted 300 GiB gp3 volume: GoAlert's Postgres and Alloy's metrics
  WAL. What the services now in the cluster kept here (Grafana's SQLite,
  Prometheus TSDB, Loki and Tempo WALs) stays on it, unused, under their old
  uids. The root disk is disposable. Volume and S3 buckets are protected and
  retained.
- Two private, encrypted S3 buckets, HTTPS required. The cluster's Loki writes
  `logs` and its Tempo `traces`, and their compactors own retention; no
  lifecycle rule can expire live blocks. The host's role may only list, read
  and write GoAlert's backups under `goalert/` in the logs bucket.
- Daily EBS snapshots retained for seven days; these are crash-consistent, not
  an application-consistent or cross-region backup. Snapshot recovery can lose
  up to a day of GoAlert state; its nightly dump is the other copy.
- No RDS or shared filesystem. GoAlert's schedules, users and alerts live in a
  local Postgres 17 on the volume.
- All service and OS versions are pinned by this stack's `flake.lock` on NixOS
  26.05. Reviewed lock updates and replacement AMIs deliver upgrades; there is
  no installation or build at boot.

A single Ohio host is not highly available, and Ohio failure is not covered by
these regional snapshots or buckets. A production region outage should not
block GoAlert login or secret retrieval in Ohio.

### Dev stacks

A stack other than `prod` gets the same names with `-dev`. There is no dev
observability cluster, so on a dev stack `grafana-dev.` and `otlp-dev.` reach
the listener's default 404, and the dev host's Alloy, which sends to
`otlp-dev.`, is refused: Alloy does not retry a 404, so it drops each batch
of metrics and logs as it sends it. `oncall-dev.` works as in prod. This
repository has no dev stack configuration (`Pulumi.dev.yaml`), and nothing
sends to the dev names: dev ECS services, the analytics proxy, CI and local
telemetry all send to `otlp.macro-internal.com`. Test a host change with the
smoke boot, which every Deploy Observability run does on a throwaway host
before production is touched (see [Deploying](#deploying)). A dev stack that
needs Grafana needs a cluster of its own.

## Host telemetry

Alloy collects the host's CPU, memory, filesystem and network metrics with its
node exporter, including the state, restarts and start times of the host's own
systemd units, and reads those units' and the kernel's journal. It sends metrics
by Prometheus remote write to `https://otlp.macro-internal.com/api/v1/write` and
logs by Loki push to `/loki/api/v1/push` on the same name: the cluster's edge,
which takes HTTP Basic with user `metrics` and the OTLP token as the password,
as the Firecracker hosts and the database collector do. Metrics arrive as
`job="integrations/unix"` (the node exporter) and `job="integrations/self"`
(Alloy itself), with the host's name as `instance`: Alloy's exporters label
their targets, which overrides the scrapes' `job_name`. Logs arrive as
`observability/journal` and `observability/kernel`, and journal streams keep
their `unit` label.

It uses these rather than OTLP, through the same name and token, because
remote write keeps a local WAL, so samples survive up to an hour while the
cluster is unreachable or failing (a 4xx other than 429 drops the batch at
once), and Loki push keeps the journal's stream labels as they are. Log
delivery uses bounded retries and does not guarantee lossless delivery through
a long outage. nginx access logs use a
restricted format without query strings and reach Loki through journald, as do
service errors.

Alloy runs as its own unprivileged user with journal access. Its UI binds only
to `127.0.0.1:12346`, EC2 metadata access is blocked, and its memory limit is
1 GiB. Its state is on the volume under `alloy`. It uses the host mount
namespace so filesystem metrics reflect the actual mounts; Unix permissions
restrict writes to its own retained directory.

CloudWatch Agent runs as a separate unprivileged NixOS service, independent of
Alloy, the data mount and GoAlert. It sends only root/data-disk utilization and
memory utilization to the `Macro/Observability` namespace using the instance
role. Alarms identify the current EC2 instance: either ext4 disk above 80% or
memory above 90% over two five-minute periods notifies the configured SNS topic,
as do a failed instance status check and an unhealthy on-call target
(`observability-goalert`). Missing data breaches the alarm, including when the
data volume is not mounted. CloudWatch collection runs every minute.

Both agent versions are pinned by `flake.lock`; their NixOS modules own startup
and restart behavior.

## Access and security

Production URLs are `https://oncall.macro-internal.com` (this host) and
`https://grafana.macro-internal.com` and `https://otlp.macro-internal.com` (the
cluster; `infra/k8s/observability/cluster/README.md` covers Grafana's login and
ingestion). Dev uses the same names with `-dev` (see [Dev stacks](#dev-stacks)).

Only the ALB is internet-facing, on TLS 1.2/1.3 port 443. The host has no public
IP, SSH key or SSH ingress. Its only ingress is port 8080 from the ALB security
group; ALB-to-host traffic is HTTP inside the VPC. Administrative access uses
AWS SSM and the operator's IAM identity. GoAlert, the relay and Alloy bind to
loopback, and Postgres listens on a Unix socket only. nginx answers only the
on-call name and the target group's health check (`/goalert-healthz`); every
other name gets 404. No HTTP listener is opened.

Secrets Manager holds the Google client credentials (GoAlert's login), the OTLP
token (host Alloy's password at the edge) and GoAlert's own secrets. EC2
retrieves them at startup into `/run` with restricted file permissions, and
systemd `LoadCredential` gives each service only its own. Secret values never
enter Pulumi state, user-data, environment variables or configuration committed
here. The secret must use the AWS-managed Secrets Manager encryption key; a
customer-managed key needs an explicit scoped KMS policy addition. IMDSv2 is
required with hop limit 1. Only the bootstrap and secret helpers, GoAlert's
backup, CloudWatch and SSM need the instance role; every service listed in
`host.nix` `services` blocks metadata access. The host is still one
administrative trust boundary.

### Grafana login and ingestion

The cluster's Grafana and edge apply this directory's `nixos/grafana.nix` and
`nixos/ingest.alloy`, with the limits the host's nginx had.

Grafana uses a **Google Workspace OAuth client**. Every member of the `macro.com`
Workspace may sign in and receives Grafana server administrator and organization
administrator access. Google hosted-domain validation and the `macro.com` domain
restriction reject accounts outside that Workspace, including personal Google
accounts. ID-token signature validation, PKCE and refresh-token checking are enabled.
Workspace administrators must enforce MFA. No password login, default admin or
anonymous access is enabled; account creation happens only after Google login.
The role policy is declared directly in `nixos/grafana.nix`; there are no per-user
access lists.

Sessions have a one-hour inactivity limit and eight-hour maximum. Suspending a
Workspace account does **not** immediately invalidate an existing Grafana session.
For offboarding, disable the Workspace account and use another Grafana admin to
disable the Grafana user and revoke their sessions. This uses OSS role mapping,
not Enterprise team sync. All team members can administer Grafana and query all
telemetry; there is no per-service data isolation. Apply redaction in the
producer pipeline before copying sensitive data.

Grafana's data sources go through the edge's query allowlist, which allows only
named query endpoints and their HTTP methods. Users can call Grafana's
data-source proxy, and direct backend URLs would also expose maintenance
endpoints such as Tempo `/shutdown` and Loki `/flush`. New data-source features
may need reviewed additions to the allowlist.

Ingestion permits only POST: `/v1/logs`, `/v1/traces` and `/v1/metrics` with
the bearer token, which Alloy checks, and `/api/v1/write` and
`/loki/api/v1/push` with HTTP Basic. The token cannot query telemetry. Requests
have an 8 MiB limit and a shared 100 requests/second limit with a 200-request
burst. Only use this token in trusted server-side collectors, never browser or
mobile clients. The token is shared; provision per-producer credentials before
expanding beyond trusted internal services.

## First deployment

The stack is deliberately absent from `.github/services-config.json`; it deploys
only through the manual workflow in [Deploying](#deploying). Use the repository's Pulumi backend
and AWS account `569036502058`, region `us-east-2`. Deployment requires the
existing public `macro-internal.com` Route53 zone; this stack creates its own VPC/NAT and
DNS-validated regional ACM certificate. Region validation rejects `us-east-1`.

1. GoAlert signs in with a Google OAuth Web client managed by the company, with
   an **Internal** consent audience (GoAlert cannot restrict OIDC to a domain).
   In prod it is the cluster Grafana's client. Add the exact redirect URI
   `https://oncall-dev.macro-internal.com/api/v2/identity/providers/oidc/callback`
   for dev or
   `https://oncall.macro-internal.com/api/v2/identity/providers/oidc/callback`
   for prod. Confirm Workspace MFA enforcement.
2. Through the approved secret-management process, create a Secrets Manager JSON
   secret in **us-east-2** containing `google_client_id`, `google_client_secret`
   and `otlp_token`, plus the GoAlert fields listed under
   [On-call paging](#on-call-paging-goalert). Generate independent
   cryptographically random values of at least 32 characters for `otlp_token`,
   `goalert_encryption_key` and `goalert_admin_password`. Preserve
   `goalert_encryption_key` through recovery; changing it makes stored
   credentials unreadable. In prod the cluster reads the same secret for its own
   fields (its README's "Secrets"); the host ignores them. Never paste secret
   values into shell commands, this file or PRs.
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

Before relying on it, validate all of these against AWS:

- A `macro.com` Workspace member can sign in to GoAlert with Google; the
  break-glass `admin` login works.
- `/health`, `/api/v2/generic/incoming`, `/api/v2/heartbeat/` and
  `/api/v2/grafana/incoming` on the on-call name reach GoAlert; other GoAlert
  integrations and other names answer 404. No backend ports or SSH are
  reachable directly.
- A test alert reaches the Macro Alerts channel and can be acknowledged and
  closed.
- `sudo systemctl start goalert-backup` leaves a dump under `goalert/` in the
  logs bucket.
- Reboot preserves data and starts services; stop/replace the host and verify
  the existing volume is reattached. Restore a snapshot to an isolated host and
  verify Postgres recovery before relying on the backup.
- Host metrics (`{job="integrations/unix"}` with the host's `instance`) and journal logs
  (`{job="observability/journal"}`) appear in the cluster's Grafana.
  CloudWatch's instance, target-health, root/data-disk and memory alarms reach
  the selected SNS subscription. Verify disk metrics use `InstanceId`, `path`
  and `fstype` dimensions, memory uses `InstanceId`, and missing data alerts.
  Confirm a daily snapshot is created.

## Operations and recovery

### Deploying

Run **Deploy Observability** (`.github/workflows/deploy-observability.yml`,
generated from `tooling/xtask/crates/xtask_workflows/src/workflows/deploy_observability.rs`)
from `main` in the Actions tab. Nothing starts it automatically.

> **A rollout takes GoAlert down.** It replaces the single host, so GoAlert is
> unavailable for several minutes, until the new host passes the on-call target
> group's health check, and pages sent to it in that window fail. Grafana,
> Loki, Tempo and ingestion run in the cluster and stay up; the host's own
> telemetry has a gap. Run it when that is acceptable.

The `dry_run` input defaults to on. A dry run does everything except replace
the host: build, publish, smoke boot, preview and the permission check. Untick it
to roll out. The steps, all in `deploy/release.ts`:

1. **Refuse a stale commit.** Branches other than `main`, and a re-run of an old
   run whose commit is behind main's last change to this stack, fail, so a rerun
   never rolls production back.
2. **Find the image.** `deploy/image-key.ts` hashes the image's source (the
   git-tracked `flake.nix`, `flake.lock`, `nixos/` and `assets/`, minus
   `NOT_IMAGE_INPUTS`: `nixos/database-collector/` and the files only the
   cluster imports, so a dashboard edit needs no new AMI). An available AMI with the tag key
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
   after the run: a bucket `observability-smoke-<run>-backup`, a secret
   `observability/smoke-<run>` of fresh throwaway values, and an IAM role and
   instance profile under the path `/observability-smoke/` with production's
   backup statements (`host-policy.ts`) on that bucket, that secret, and SSM.
   It launches the AMI as an `m7i.xlarge` in the host's subnet and security
   group with a blank 20 GiB volume, never production storage. The smoke
   host has no CloudWatch, SNS or production access, its hostnames do not
   resolve, and its relay posts to an `.invalid` webhook, so it cannot page
   anyone. Over SSM it waits up to 15 minutes for every unit in `UNITS` to be
   active (`observability-bootstrap`, `observability-secrets`, `nginx`,
   `postgresql`, `goalert`, `macro-alerts-relay`, `alloy`) and for
   `/goalert-healthz` and Alloy's `/-/ready` to answer. Then, through nginx as
   the ALB sends it (`pagingCheckScript`): on-call `/health` and the UI answer;
   the Grafana and ingest names and an unused integration answer 404, and
   Grafana paging without a key 401. As the `admin` login it creates a service
   whose escalation posts to the relay, with a generic key (Datadog's), a
   Grafana key (the cluster's) and a heartbeat monitor, pages through each,
   checks GoAlert stored both alerts, and waits for the relay to log GoAlert's
   post. It runs `goalert-backup` and finds the dump in the bucket, and checks
   Alloy sends metrics and logs to the edge's address. Cleanup stops the
   host, detaches and terminates it (the calls a rollout makes), then deletes
   the volume, bucket, secret, instance profile and role. It sweeps every
   smoke resource, not only this run's, so a cancelled or crashed run's
   leftovers go too, and a cleanup that cannot delete something fails the
   run. A pass tags the AMI `Smoke=passed` and `ImageSource:<hash>`; a failure
   tags `Smoke=failed`, prints the failing units' journals and the console,
   and stops the run with production untouched.
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
   up to 25 minutes for the new instance to pass the on-call target group's
   health check and for `https://oncall.macro-internal.com/health`, and prints
   how long the update took.

**A change the plan check refuses**, such as the host role's policy, goes in
by hand, with permission for that deploy and after review. Run the workflow as
a dry run first: it builds, smoke-boots and tags the AMI before its plan check
stops it, and `pulumi preview` fails until that tag exists. Then preview and
apply only the refused resources, and run the workflow again for the host:

```bash
\cd infra/stacks/observability
urn='urn:pulumi:prod::observability::aws:iam/rolePolicy:RolePolicy::observability-storage'
pulumi preview --stack macro-inc/observability/prod --diff --target "$urn"
pulumi up --stack macro-inc/observability/prod --diff --target "$urn"
```

The workflow cannot replace the host while such a change is pending, so it
always lands before the new image: a permission it removes must be one the
running image no longer needs.

**The GoAlert-only rollout** (step 8 of the cluster's switch,
`infra/k8s/observability/cluster/README.md`) narrows the role this way. It
takes the bucket access from the old host's Loki and Tempo and the CloudWatch
reads and SNS publish from its Grafana, so apply it only once the cluster owns
all three:

1. Switch steps 1 to 7 are done: on the old host `loki`, `tempo`, `grafana`
   and `prometheus` are held and inactive
   (`systemctl show -p Id -p ActiveState loki tempo grafana prometheus`), and
   the cluster's Loki and Tempo run on these buckets.
2. The cluster's Grafana notifies (*Cluster, notify* is merged and synced) and
   its watchdog's heartbeat monitor on the observability service is healthy
   in GoAlert.
3. Then the dry run, the targeted `pulumi up` above, and the real run.
4. Right after, check the cluster's contact points reach GoAlert, which only
   this host's nginx lets through: each contact point's **Test** in the
   cluster's Grafana arrives as an alert in GoAlert. `GoAlert notify` reaches
   the Notify service, which posts to the Alerts channel and phones nobody;
   `GoAlert` pages the on-call, so tell them first and close the alert after.
   A healthy heartbeat alone doesn't prove the contact points' keys.

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
To roll back, put the previous host source back on `main` (only the files
under this stack that changed; a plain revert of a commit that also changed
the cluster would take that with it) and run the workflow again: the
previous source's AMI still carries its tag, so nothing is rebuilt. A change
the plan check refuses goes in by hand first, as above. For the GoAlert-only
rollout itself, go back as below instead.

**Going back to the full host** (an image from before the GoAlert-only
change) is the cluster README's "Going back", not a plain revert. That image
starts Grafana, Loki and Tempo at boot, on the buckets the cluster's Loki and
Tempo write, and its Grafana notifies. So first take the cluster's Loki and
Tempo off these buckets and stop its Grafana (that README's "Going back" step
1, with its checks that no old pod is left). Only then revert on `main`, widen
the role with the targeted `pulumi up` above, and run the workflow, a dry run
first.

Rolling an AMI back does not roll back GoAlert schema migrations; use a tested
snapshot recovery when the old version cannot read current data.

**What survives a replacement.** Nothing the services keep is on the replaced
host:

- The two S3 buckets, which Pulumi protects and retains (`durable`), hold the
  cluster's Loki chunks and Tempo blocks and GoAlert's dumps; nothing about
  them depends on the image.
- Everything local is on the `observability-data` EBS volume: GoAlert's
  Postgres and Alloy's WAL and journal positions, beside the unused data of the
  services that moved to the cluster. The volume is protected and retained,
  and none of its inputs change with the image, so the plan check requires it
  to be unchanged.
- Only the volume attachment is replaced. It has `stopInstanceBeforeDetaching`,
  so the old host stops cleanly (systemd gives each service 90 seconds) before
  the detach, and `forceDetach: false`.
- The new host's bootstrap waits for that exact volume ID, mounts it without
  formatting (`prepare-volume.sh` formats only a disk with no filesystem or
  signatures), and stable uids keep file ownership. Every service checks the
  mount before starting, so none falls back to the root disk.
- The root disk is disposable and holds nothing to keep.

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
sudo systemctl status observability-bootstrap observability-secrets nginx postgresql goalert macro-alerts-relay alloy
sudo journalctl -u observability-bootstrap -u observability-secrets --since boot
sudo journalctl -u nginx -u goalert -u macro-alerts-relay -u alloy --since '30 minutes ago'
```

Nonsecret runtime values arrive as versioned, compressed JSON in EC2 user-data.
`read-user-data.py` retrieves them through IMDSv2 and validates the exact schema,
region, hostnames and bucket/volume/secret identifiers.
It writes a systemd environment file, the on-call nginx server block, the
secret's identifier and the expected volume ID under `/opt/observability`. It
does not execute user-data or read secret values. The standard NixOS user-data
evaluator is disabled. Schema version 7 rejects other payloads, unknown
settings and caller-supplied files; deploy it with the image that reads it.

`observability-bootstrap` mounts that exact EBS volume and creates each service's
data directory using stable, named NixOS users. `prepare-volume.sh` formats only
a disk with no filesystem or signatures; existing ext4 data is preserved.
Application units verify the mount before every startup, preventing fallback to
the root disk. Bootstrap retries every 30 seconds after metadata or attachment
failure, and its systemd `Upholds` relationships start nginx, Postgres and
`observability-secrets` after recovery.

`observability-secrets` fetches the credential bundle into root-only files under
`/run`. GoAlert, the relay and host Alloy wait for successful retrieval and
receive private credential copies from systemd; the secret service upholds them.
Secret-service outages retry every 30 seconds; nginx and Postgres run
independently of that service. Systemd restarts crashed processes individually
with memory and filesystem limits.

Configuration/image changes require a new image; runtime value changes do not
need an image rebuild. Both kinds of changes replace the instance and cause
downtime (see [Deploying](#deploying)). The old instance is deleted before replacement, its
volume is detached, then the new host waits for that retained volume.

To rotate the Google client secret, the OTLP token or the relay's webhook and
token, update Secrets Manager, then run
`sudo systemctl restart observability-secrets`. This stops GoAlert, the relay
and Alloy while credentials refresh, then restarts them with new private
copies. Restarting an individual service uses the last fetched bundle. The
cluster's ingest and edge read the same OTLP token; rotate them together, and
coordinate every producer, since there is no dual-token grace window. Do not
casually rotate GoAlert's encryption key.

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

The host is a single point of failure for paging: while it is down, pages to
GoAlert fail, and the `observability-goalert` alarm notifies the SNS topic
without GoAlert.

## Dashboards and alert migration

### Service exploration

The cluster's Grafana installs the signed Logs, Metrics, and Traces Drilldown
apps, at the versions in `infra/k8s/observability/cluster/env/prod.nix`.
Use **Drilldown → Logs** to choose a service and inspect its log volume, fields,
and patterns, or **Drilldown → Traces** to filter services, errors, and latency.
The dev telemetry dashboard also has a service selector and links to all three
Drilldown apps. The service selector discovers names from dev logs; a service
that emits only traces or metrics can be found in the corresponding Drilldown.

Loki enables pattern ingestion, log-level detection, and volume queries. Tempo's
metrics generator enables TraceQL metrics, span metrics, and service graphs, and
writes the generated metrics to Mimir. They describe
received spans, so sampling and missing instrumentation can prevent parity with
Datadog request counts. Span names remain in Tempo rather than becoming unbounded
Prometheus labels. Generated series are capped at 50,000; monitor
`tempo_metrics_generator_registry_series_limited_total` and local-block discards
before expanding ingestion. The cluster's README covers how these backends run.

Tempo spans link to the service's logs in a time window and its generated metrics;
logs carrying an OTLP trace ID link back to the trace. FireLens logs do not always
carry trace IDs, so service/time correlation is not a claim of exact trace-to-log
matching. Service graph edges require correctly related client/server spans.
Profiles, production/full database-query parity, RUM/session replay, and complete
Datadog dashboard/monitor migration remain separate coverage work.

### Provisioned dashboards and alerts

Everything Grafana provisions lives in `nixos/grafana-provisioning/` as plain
Nix data, not NixOS modules: `default.nix` takes nixpkgs' `lib` and the values
that differ between the places Grafana runs, and returns

- `datasources`: the datasources provisioning document;
- `alerting`: the `contactPoints`, `policies` and `rules` documents;
- `dashboards`: one entry per dashboard provider, `{ name; folder; files; }`,
  each file `{ name = "<file>.json"; dashboard = <dashboard JSON>; }`.

Its parameters are `goalertUrl` (GoAlert's base URL) and `datasourceUrls` (the
`prometheus`, `loki` and `tempo` query endpoints). The cluster's Grafana
(`infra/k8s/observability/cluster/modules/grafana.nix`) imports it with its own
values: GoAlert at `https://oncall.macro-internal.com`, through the ALB, and
the cluster's query endpoints.

Grafana also needs `GRAFANA_ALERT_TOPIC_ARN`, `GOALERT_GRAFANA_KEY` and
`GOALERT_GRAFANA_NOTIFY_KEY` in its environment (the contact points expand
them), and AWS credentials that can read CloudWatch in us-east-1 and publish to
that topic. The on-call vhost lets `/api/v2/grafana/incoming` through
(`nixos/proxy.nix`); GoAlert checks the integration key.

Keep values that depend on where Grafana runs out of the data: add a parameter
instead. The host's image does not read this directory (`NOT_IMAGE_INPUTS` in
`deploy/image-key.ts`), so a dashboard or rule change needs no new AMI and no
Deploy Observability run; it ships with the cluster's rendered manifests (the
cluster's README).

Nix provisions the `Macro` dashboard folder, a dev telemetry dashboard, and a
CloudWatch database/Lambda dashboard. CloudWatch reads native metrics in Virginia;
it does not replicate their history to Ohio, so these panels depend on Virginia
remaining available. These are not a replacement for Datadog database query monitoring, RUM, or anomaly
models.

`nixos/grafana-provisioning/prod-alerts.nix` lists the prod CloudWatch alerts:
macrodb memory, swap, load, CPU, connections, replica lag, read latency and
storage; Redis memory and evictions; SQS queue age. Each entry holds its query,
thresholds, window and text once. `nixos/grafana-provisioning/alerting.nix`
turns each into a warning and a critical rule in the `Prod` group, reading
CloudWatch in Virginia directly, and
`nixos/grafana-provisioning/prod-alerts-dashboard.nix` draws it as one panel
with both thresholds on the `Prod alerts` dashboard (`/d/prod-alerts`, rows macrodb, Redis and Queues).
Each rule carries its panel as `__dashboardUid__`/`__panelId__`, so the rule
view links to the graph of the metric that fired, and as a `panel_url`
annotation built from Grafana's `externalURL`, because GoAlert's alert details
list annotations but not Grafana's panel link. Each
has a Datadog copy in `infra/stacks/monitoring/monitors/`; keep thresholds and
windows in sync by hand. Forecasts, anomalies, Database Monitoring, APM and log
rules are Datadog-only.

`nixos/grafana-provisioning/email-focus.nix` holds the Email Focus rollout's go/stop checks over the
worker's `Macro/EmailFocus` metrics. Each becomes a warning and a critical rule
in the `Email Focus` group and a panel on the `Email Focus rollout` dashboard
(`/d/email-focus-rollout`), linked the same way as the prod alerts. They never
page and have no Datadog copies. See `docs/runbooks/email-focus.md`.

Every prod alert goes to GoAlert through the ALB, and GoAlert alone posts to the
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

The `Macro team email` contact point publishes through SNS with Grafana's AWS
credentials, without SMTP credentials. The configured topic has the team's email
subscriptions; each recipient must confirm their SNS subscription.
Test the contact point and verify receipt before relying on notifications.

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
  `/health`, `/api/v2/generic/incoming`, `/api/v2/heartbeat/` and
  `/api/v2/grafana/incoming` are reachable without a session (GoAlert checks
  the integration key); the last is the cluster Grafana's
  (`infra/k8s/observability/cluster`). Other inbound integrations return 404.
  The rest is GoAlert's UI behind its login.
- Login is Google OIDC with the cluster Grafana's OAuth client, whose redirect URIs include
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
The cluster's Grafana reads `goalert_grafana_integration_key` (the
`Grafana critical` Grafana key), `goalert_grafana_notify_integration_key` (the
`Notify` Grafana key) and `goalert_cluster_heartbeat_id` from the same secret
(its README, "Secrets"); the host does not. Without a key, GoAlert rejects that
contact point's alerts with 401 and Grafana shows it as failing.

### First deployment

1. Add the secrets above, then deploy the host as usual. The
   certificate gains the on-call name, so Pulumi replaces the ACM certificate and
   updates the listener.
2. Sign in as `admin`. Create the escalation policies and services below, and a
   Grafana integration key on `Grafana critical` and on `Notify`. Put the keys in
   Doppler and the secret as `goalert_grafana_integration_key` and
   `goalert_grafana_notify_integration_key`, for the cluster's Grafana.
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
The cluster's edge serves the authenticated POST-only `/loki/api/v1/push` route
on the ingest name. The route reuses the existing ingestion credential and
exposes no Loki query or administration APIs. SQL records are
sensitive and use Loki's existing retention/access controls. Database setup and
collector deployment are manual; merging the PR does not enable collection.

## Validation and subsequent passes

From `infra/`, run `bunx biome check stacks/observability` and `bun run check`.
Build the complete NixOS image from this stack directory with `nix build . --cores 2`.
Every Deploy Observability run smoke-boots a new image on a throwaway host
before production is touched ([Deploying](#deploying), step 4): service
startup, the on-call routes through nginx, paging into GoAlert and out through
the relay, the backup and the telemetry target. Real Google login, the ALB and
TLS, the production volume's reattachment and snapshot restore remain the
deployment acceptance checks above.

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
   Cut off Datadog only after coverage and operational acceptance are
   demonstrated.

Grafana, Loki, Tempo and metrics moved to the observability cluster, with
Grafana on RDS and Loki and Tempo on this stack's buckets
(`infra/k8s/observability`).

References: [Google OAuth](https://grafana.com/docs/grafana/latest/setup-grafana/configure-access/configure-authentication/google/),
[Alloy bearer authentication](https://grafana.com/docs/alloy/latest/reference/components/otelcol/otelcol.auth.bearer/),
[Loki retention](https://grafana.com/docs/loki/latest/operations/storage/retention/),
[Tempo supported versions](https://grafana.com/docs/tempo/latest/set-up-for-tracing/setup-tempo/recommended-versions/).
