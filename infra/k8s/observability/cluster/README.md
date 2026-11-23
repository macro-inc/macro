# Observability cluster contents

Everything that runs on the observability EKS cluster (`observability`,
us-east-2), written as [nixidy](https://github.com/arnarg/nixidy) modules and
rendered to plain YAML under `manifests/prod/`. Argo CD on the cluster reads
`manifests/prod/` from `main` and applies it, so merging a change here deploys
it. The cluster itself, its IAM and the Pod Identity associations are
OpenTofu under `../aws/`.

```
modules/*.nix ──nix run .#render──▶ manifests/prod/ (committed) ──main──▶ Argo CD ──▶ cluster
```

## What runs

| Application | Namespace | What it is |
| --- | --- | --- |
| `apps` | `argocd` | The app of apps: one Application per directory below. Applied once by hand (bootstrap); it is in `apps/` itself, so from then on it manages itself too. |
| `argocd` | `argocd` | Argo CD, managing itself. Every Application syncs with prune and self-heal, automatically while `macro.cluster.autoSync` is on (below). UI and API at `argo.macro-internal.com`, Google sign-in, read-only ("Argo CD" below). |
| `cert-manager` | `cert-manager` | Issues the load balancer controller's webhook certificate. |
| `aws-load-balancer-controller` | `kube-system` | Registers pods in ALB/NLB target groups (`TargetGroupBinding`). Creates no load balancers: no IngressClass, Service controller, Service mutator or Ingress validation, and its role can only register targets. |
| `external-secrets` | `external-secrets` | External Secrets Operator and the `secrets-manager` ClusterSecretStore over the Secrets Manager secret `observability/prod`. Only cluster admins can create stores (namespace `edit` and `admin` can't), since a store without credentials reads with the operator's. |
| `storage` | `kube-system` | The default `gp3` StorageClass (EBS CSI, encrypted, expandable). |
| `observability-namespace` | `observability` | The namespace the backends and Grafana run in, default-deny NetworkPolicies and the policies they share. |
| `alloy-node` | `alloy` | One Alloy per node for the cluster's own node, kubelet, cAdvisor and pod-log telemetry. Sends to Mimir and Loki. |
| `loki` | `observability` | Loki, three single-binary replicas, logs in S3. |
| `tempo` | `observability` | Tempo (tempo-distributed), three ingesters, traces in S3; its metrics generator writes span metrics and service graphs to Mimir. |
| `mimir` | `observability` | Mimir, three monolithic replicas, metrics in S3, in place of the host's Prometheus. |
| `reloader` | `observability` | Restarts a Deployment when a Secret it names in `secret.reloader.stakater.com/reload` changes (Grafana's rotated database password). |
| `grafana` | `observability` | Grafana, two replicas on RDS Postgres with HA alerting between them, provisioned from the host's `nixos/grafana-provisioning`. Sends no notification until the switch, except the watchdog heartbeat (below). |
| `edge` | `observability` | nginx, the only target of the ALB: Grafana and Argo CD by hostname, OTLP to `alloy-ingest`, basic-auth remote write and Loki push. Runs only in the ALB's zones. |
| `query-gateway` | `observability` | nginx between Grafana's datasources and the backends: only query endpoints and methods pass. |
| `alloy-ingest` | `observability` | Two Alloys running the host's `nixos/ingest.alloy`: check the OTLP token, send to Loki, Tempo and Mimir. |

Charts are pinned in `charts/<repo>/<chart>/default.nix` (version and hash).

## Commands

Run from this directory.

| Command | What it does |
| --- | --- |
| `nix run .#render` | Renders the modules into `manifests/prod/`. Commit the result with the change. |
| `nix run .#check` | Fails when `manifests/prod/` differs from a fresh render, then validates. CI runs this (`observability_cluster.yml`). |
| `nix run .#validate` | Validates the manifests strictly with kubeconform: core kinds against the Kubernetes schemas for the cluster's version, custom resources against the CRDs being installed. |
| `nix run .#kind-smoke` | Bootstraps the pushed branch onto a throwaway kind cluster and waits for the applications. Every application must sync and be healthy except those that need AWS: `aws-load-balancer-controller` (VPC lookup), `external-secrets` (the ClusterSecretStore), `loki`, `tempo` and `mimir` (gp3 volumes and S3), and `grafana`, `edge` and `alloy-ingest` (their secrets); `edge` may also stay unsynced (its TargetGroupBindings need the controller's webhook). Pass `--delete` to remove the cluster afterwards. |
| `nix run .#bootstrap -- --context <ctx>` | The one-time bootstrap below. |

## Bootstrap (once, after the cluster exists)

Argo CD can't install itself on an empty cluster. Once `../aws/` has created the
cluster and its Pod Identity associations, and this directory is on `main`, run
this from a clean checkout of `main` (the script refuses anything else):

```sh
# kubeconfig with context `observability`: ../aws/README.md "Cluster access"
nix run .#bootstrap -- --context observability
```

`bootstrap` installs Argo CD from `manifests/prod/argocd/` with server-side apply
as Argo CD's own field manager, waits for it, and applies
`manifests/prod/apps/Application-apps.yaml`. From then on Argo CD syncs
everything from `main`, Argo CD and the `apps` Application included; nothing is
applied by hand again.

On a new cluster, set `macro.cluster.autoSync = false` in `env/prod.nix`,
render and merge it before the bootstrap (prod ran its first rollout that way).
`apps` still syncs itself, but it holds only the Application objects; every
other application shows what it would change and applies nothing until
someone syncs it. Read each diff, then sync `external-secrets` (its CRD
comes first: `argocd` has an ExternalSecret), `argocd` (until then the
bootstrap's copy runs), and the rest in the order of the table above.

The UI is read-only (below), so sync with the CLI as a cluster admin, which
talks to the cluster through kubectl and needs no Argo CD login. It uses the
context's namespace, so set that to `argocd` once:

```sh
kubectl config set-context observability --namespace argocd
a="nix shell nixpkgs#argocd -c argocd --core --kube-context observability"
$a app list
$a app diff argocd/cert-manager
$a app sync argocd/cert-manager
```

Then a change sets `autoSync = true`, and merging deploys from then on. Prod
has it on.

The local `admin` account is off (`admin.enabled = false`), so the install's
`argocd-initial-admin-secret` is useless; delete it after the bootstrap
(`kubectl --context observability -n argocd delete secret argocd-initial-admin-secret`).

The repository is public, so Argo CD clones it over HTTPS without a deploy key
(shallow, `depth: 1`). If it ever goes private, add a read-only deploy key to
`observability/prod` and an ExternalSecret for the repository Secret.

## Argo CD

The UI and API are at https://argo.macro-internal.com: the ALB (listener rule,
DNS record and certificate from `../aws/` settings `hosts.argocd`) → the edge
→ `argocd-server`, plain HTTP inside the cluster (`server.insecure`).

- **Sign-in** is Google only, through Argo CD's Dex
  (`modules/platform/argocd.nix`), for accounts in `macro.com`: Dex rejects
  any account without that hosted domain. It uses Grafana's Google OAuth
  client (`google_client_id`, `google_client_secret` in `observability/prod`,
  through the ExternalSecret `argocd-google`), whose authorized redirect URIs
  must include `https://argo.macro-internal.com/api/dex/callback`.
- **Everyone is read-only** (`policy.default: role:readonly`): applications,
  diffs, history, resources and pod logs, with Secret values masked, plus a
  refresh (re-reading `main`), which changes nothing. Nothing grants more. Changes ship by merging to `main`; anything else (a manual sync, a
  rollback) is a cluster admin with `argocd --core` ("Bootstrap").
- **No local accounts**: `admin.enabled = false`.
- The ALB alarms see only the edge, so after any change to sign-in (the OAuth
  client, `dex.config`, the hostname), sign in once in a browser.
- The CLI signs in through the browser:
  `argocd login argo.macro-internal.com --sso --grpc-web`.

## What `../aws/` must provide

- An EKS cluster named `observability` in us-east-2, Kubernetes 1.37
  (`env/prod.nix`), with the EBS CSI driver and the Pod Identity agent add-ons.
- A VPC tagged `project=observability`, `environment=prod`: the load balancer
  controller finds it by tag, because pods can't reach IMDS.
- Pod Identity associations for these service accounts:

  | Namespace | Service account | Needs |
  | --- | --- | --- |
  | `kube-system` | `aws-load-balancer-controller` | the controller's IAM policy |
  | `kube-system` | `ebs-csi-controller-sa` | EBS CSI |
  | `external-secrets` | `external-secrets` | read `observability/prod` and Grafana's RDS-managed database secret |
  | `observability` | `loki`, `tempo`, `mimir` | read and write their own bucket (below) |
  | `observability` | `grafana` | CloudWatch read, `sns:Publish` on the alerts topic |

## Backends

Loki, Tempo and Mimir (`modules/backends/`) each keep three copies of recent
data (replication 3, quorum 2), one replica per zone, and older data in their
own S3 bucket, so a rollout, a drained node or a lost zone loses neither
writes nor queries. Two parts keep one copy: Tempo's metrics generators and
Loki's pattern ingester each own a share of the series or streams, so while a
replica is down its share of span metrics, service graphs and log patterns
is missing. Each pod keeps its WAL on a gp3 volume.

| Backend | Write | Query | Bucket |
| --- | --- | --- | --- |
| Loki | `loki:3100` `/loki/api/v1/push`, OTLP `/otlp` | `loki:3100` | `macro-observability-k8s-loki` |
| Tempo | `tempo-distributor` OTLP gRPC `:4317`, HTTP `:4318` | `tempo-query-frontend:3200` | `macro-observability-k8s-tempo` |
| Mimir | `mimir:8080` remote write `/api/v1/push`, OTLP `/otlp` | `mimir:8080/prometheus` | `macro-observability-k8s-mimir` |

Full URLs are in `modules/backends/endpoints.nix`; other modules import them
from there. No tenant headers: Loki runs without auth (tenant `fake`), Tempo
and Mimir without multitenancy.

Retention (logs 30 days, traces 7, metrics 30), limits and features (pattern
ingestion, level detection, span metrics, service graphs) come from the
single host's `infra/stacks/observability/nixos/backend-config.nix`, so the
two stay the same while both run; CI re-checks the render when it changes.

- **Loki** runs the chart's monolithic mode: every replica runs every
  component.
- **Tempo** uses tempo-distributed 2.26.2 (Tempo 2.10), the last chart with
  the classic ingesters; later charts run Tempo 3, whose write path needs
  Kafka.
- **Mimir** is a hand-written StatefulSet with `-target=all`, because the
  mimir-distributed chart has no monolithic mode. It takes Prometheus remote
  write at `/api/v1/push` (Prometheus took it at `/api/v1/write`) and serves
  the Prometheus API under `/prometheus`.

The node Alloy sends its metrics to Mimir and its logs to Loki, and scrapes
the backends' own `/metrics`: `macro.alloyNode`, set in
`modules/backends/default.nix`.

## Adding a component

Grafana, ingest and the edge each come as one module under
`modules/` imported from `modules/default.nix`, as their own Application in the
`observability` namespace. Each one:

- brings its own NetworkPolicies for its traffic: the namespace denies
  everything else. DNS is already allowed; label a pod
  `observability.macro.com/aws-apis: "true"` to let it reach AWS APIs, S3 and
  the Pod Identity agent;
- reads secrets with an `ExternalSecret` against the `secrets-manager`
  ClusterSecretStore (`config.macro.cluster.secretStore`);
- uses a service account named in the table above, so Pod Identity applies.

Their pods reach the backends at the URLs in `modules/backends/endpoints.nix`;
label writers `observability.macro.com/telemetry-write: "true"` and readers
`observability.macro.com/telemetry-read: "true"` (`clientLabels` there).

## Grafana, the edge and ingest

```
ALB ─▶ edge ─┬─ grafana.* ──▶ grafana ──▶ query-gateway ──▶ Loki, Mimir, Tempo
             ├─ /v1/{traces,logs,metrics} ──▶ alloy-ingest ──▶ Loki, Tempo, Mimir
             └─ /api/v1/write, /loki/api/v1/push (basic auth) ──▶ Mimir, Loki
```

The edge and the query gateway are the full host's nginx rules, ported by
hand; Alloy ingest runs the host stack's `nixos/ingest.alloy` with the
cluster's addresses; Grafana runs the host's `grafana.nix` settings and
`grafana-provisioning`. A change to those host files changes this render too
(CI watches them).

Every one runs two replicas in different zones with a PodDisruptionBudget,
surge-first rolling updates, readiness probes and a `preStop` pause, so a
rollout or a drained node never drops traffic. From the switch on
(`macro.edge.albReadinessGate`), the edge's pods also carry the load balancer
controller's readiness gate: a new pod is ready only once the ALB sees it
healthy. Before the switch no listener rule uses the edge's target groups, so
the ALB never checks them and a gated pod would never become ready.

**Notifications.** Only one Grafana may notify, and until the switch that
is the host's. `macro.grafana.notify = false` (`env/prod.nix`) mutes every
notification route, so rules evaluate and show state here but nothing reaches
GoAlert, SNS or anyone. The one exception is the watchdog: an always-firing
rule that pings a GoAlert heartbeat monitor every two minutes, so GoAlert pages if
this Grafana, its alerting or its path to GoAlert stops. The switch sets
`notify = true`. Muting covers notification policies only: a contact point's
**Test** button in the UI sends for real even while muted; don't press it
before the switch.

**Secrets.** From `observability/prod` (values in Doppler `observability/prd`):

| Key | Used by | Missing means |
| --- | --- | --- |
| `otlp_token` | `alloy-ingest` (bearer token), `edge` (basic-auth password of user `metrics`) | neither starts: no ingest, and no Grafana either, since it is behind the edge |
| `google_client_id`, `google_client_secret`, `grafana_secret_key` | `grafana` | Grafana doesn't start |
| `goalert_grafana_integration_key`, `goalert_grafana_notify_integration_key` | `grafana` contact points | they fail once unmuted |
| `goalert_cluster_heartbeat_id` | the watchdog | it pings a URL that doesn't exist, and GoAlert never pages for it |

The database secret is the RDS-managed one (`macro.grafana.database.secret`);
RDS rotates it yearly (`../aws/`). The old password stops working at once,
so until Grafana has the new one, existing pooled connections keep working
but new connections fail. The ExternalSecret refreshes every minute and
Reloader then rolls Grafana surge-first; each old pod fails new connections
until it is replaced. So a rotation costs up to a minute plus the rolling
restart of failed new connections, once a year.

### Before Grafana runs

Grafana stays at 0 replicas until its database is set. Each step needs someone
with access to the system named:

1. **Database** (after `../aws/` is applied): set `macro.grafana.database.host`
   and `.secret` in `env/prod.nix` from the outputs `grafana_db_address` and
   `grafana_db_secret_arn`, render, and merge.
2. **Google sign-in for testing** (a Google Workspace admin): add
   `http://localhost:3000/login/google` as an authorized redirect URI of the
   OAuth client the host's Grafana uses. Until the switch
   `macro.grafana.localTesting` serves Grafana at that address;
   `https://grafana.macro-internal.com/login/google` is registered already.
3. **Watchdog** (a GoAlert admin): create a heartbeat monitor on the
   observability service, timeout 5 minutes, and put its ID as
   `goalert_cluster_heartbeat_id` in Doppler `observability/prd` and Secrets
   Manager `observability/prod`.
4. **Service accounts**: Grafana service accounts and their tokens live in the
   database, so they don't come over from the host; recreate the ones still
   in use and hand out the new tokens.
5. **GoAlert's Grafana path**: this Grafana's GoAlert contact points post to
   `POST /api/v2/grafana/incoming` on `oncall.macro-internal.com`. The host
   running before the switch answers 404 there; the GoAlert-only host lets it
   through, so they page only from the switch's step 8 on. The watchdog's
   heartbeat path passes on both.

### Testing before the switch

Nothing in AWS sends traffic to the cluster yet, and Loki and Tempo write to
the cluster's own buckets, so testing touches nothing the host uses. From a
machine with cluster access (`../aws/README.md` "Cluster access"):

- **Grafana**: `kubectl --context observability -n observability port-forward
  svc/grafana 3000:80`, open http://localhost:3000 and sign in with Google.
  Dashboards load; each datasource's **Test** passes (Connections, Data
  sources). Don't press **Test** on a contact point: it sends for real.
  Sign-in comes back to localhost because `macro.grafana.localTesting` is on.
- **Ingest through the edge**, as the ALB will send it. The edge pods are
  ready without the ALB (`macro.edge.albReadinessGate` is off until the
  switch):
  ```sh
  kubectl --context observability -n observability port-forward svc/edge 8080:8080 &
  token=$(aws secretsmanager get-secret-value --region us-east-2 --secret-id observability/prod \
    --query SecretString --output text | jq -r .otlp_token)
  now=$(date +%s%N)
  curl -fsS http://localhost:8080/v1/logs -H 'Host: otlp.macro-internal.com' \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d '{"resourceLogs":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"switch-test"}}]},"scopeLogs":[{"logRecords":[{"timeUnixNano":"'"$now"'","body":{"stringValue":"switch test"}}]}]}]}'
  curl -fsS http://localhost:8080/v1/traces -H 'Host: otlp.macro-internal.com' \
    -H "Authorization: Bearer $token" -H 'Content-Type: application/json' \
    -d '{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"switch-test"}}]},"scopeSpans":[{"spans":[{"traceId":"5b8efff798038103d269b633813fc60c","spanId":"eee19b7ec3c1b174","name":"switch-test","kind":1,"startTimeUnixNano":"'"$now"'","endTimeUnixNano":"'"$((now + 1000000))"'"}]}]}]}'
  ```
  In Grafana, Explore finds `{service_name="switch-test"}` in Loki and trace
  `5b8efff798038103d269b633813fc60c` in Tempo.
- **A lost node**: watch `kubectl --context observability -n observability
  get deploy,sts -w` in one terminal and run `kubectl --context observability
  drain <node> --ignore-daemonsets --delete-emptydir-data` in another. Every
  Deployment and StatefulSet keeps at least one ready replica throughout (a
  port-forward drops when its pod is evicted; start it again). Then rerun the
  ingest calls and `kubectl --context observability uncordon <node>`.
- **The Mimir backfill, with one old block.** In `../aws/` set
  `mimirBackfill.enable = true`, plan and apply. On the host (SSM, see
  `infra/stacks/observability/README.md` "Runtime"), as root (`sudo -i`:
  Prometheus' directory is readable only by root and `prometheus`), copy one
  of Prometheus' oldest blocks (directories named by a ULID, oldest first):
  ```sh
  cd /srv/observability/prometheus/data
  ls -d 01*/ | head -3
  block=<one of them, without the slash>
  cat "$block/meta.json"                      # minTime and maxTime, in ms
  test -f "$block/meta.json" && aws s3 sync --region us-east-2 \
    "$block" "s3://macro-observability-k8s-mimir/blocks/anonymous/$block"
  ```
  Within about 15 minutes (Mimir's compactor rebuilds the bucket index), the
  `prometheus` datasource shows the host's series over that range. Leave the
  block there: the switch copies it again, and if Prometheus has compacted it
  into a larger block by then, Mimir's compactor merges the overlap. Set
  `enable` back to false and apply.

### The switch

Loki and Tempo must never run on the host and in the cluster against the same
bucket, and traffic moves last. Every step has its preview; nothing below runs
before its go-ahead. No host deploy may run between step 3 and step 8: a new
host starts Loki and Tempo again.

**Prepared beforehand, reviewed, not merged:**

- *Cluster, buckets*: `macro.backends.buckets` set to `../aws/`'s
  `host_buckets` output (`loki` = `logs`, `tempo` = `traces`), rendered.
- *Cluster, public*: `macro.grafana.localTesting = false` and
  `macro.edge.albReadinessGate = true`, rendered.
- *Cluster, notify*: `macro.grafana.notify = true`, rendered.
- *AWS layer*: `switched = true` and `mimirBackfill.enable = true` in
  `../aws/settings.nix`; its plan reviewed (two listener rules, four alarms,
  Mimir's bucket policy).

**On main already, not applied:** the observability Pulumi stack
(`infra/stacks/observability`) describes the host after the switch, and prod
runs the host from before it. Three changes are pending there:

- *Listener rule*: the stack's priority-1 rule, its target group and
  attachment, and the `observability-ui` alarm are removed. Step 5 applies
  only these, by hand, with `--target`.
- *Host role*: narrowed to GoAlert's bucket prefix. Step 8 applies it by hand.
- *Host image*: GoAlert only; the host stops running Grafana, Loki, Tempo,
  Prometheus and OTLP ingest (its own telemetry Alloy stays), and its nginx lets Grafana's GoAlert path through.
  Step 8 deploys it.

Deploy Observability refuses a plan with deletes or a role change, so it
can't replace the host before step 8, and no other host change can ship
until then. `pulumi preview` needs an AMI tagged for main's image source: a
dry run of Deploy Observability builds and tags one, then stops at its plan
check (expected while these are pending).

**On the host**, every step uses this to stop a unit and keep it stopped
(bootstrap and `observability-secrets` start them again otherwise, and NixOS
units in `/etc` take precedence over `systemctl mask --runtime`):

```sh
hold() {
  for unit in "$@"; do
    sudo mkdir -p "/run/systemd/system/$unit.service.d"
    printf '[Unit]\nConditionPathExists=/run/observability-switch-never\n' |
      sudo tee "/run/systemd/system/$unit.service.d/switch-hold.conf" >/dev/null
  done
  sudo systemctl daemon-reload
  sudo systemctl stop "$@"
  systemctl show -p Id -p ActiveState "$@"    # every one: ActiveState=inactive
}
release() {
  for unit in "$@"; do sudo rm -f "/run/systemd/system/$unit.service.d/switch-hold.conf"; done
  sudo systemctl daemon-reload
  sudo systemctl start "$@"
}
```

**Before step 3**, while nothing has stopped yet: run Deploy Observability
on main as a dry run, which tags main's AMI (it then stops at its plan check,
as expected), and run step 5's `pulumi preview`. It must list exactly the four
deletes; anything else, stop here.

**Steps:**

1. **Apply the AWS layer** and wait for healthy targets (`../aws/README.md`
   "The switch"). No traffic moves yet.
2. **Merge *Cluster, public***. Sync `observability-namespace` first, so the
   new edge pods get the readiness gate, then `edge` and `grafana`:
   ```sh
   argocd app sync argocd/observability-namespace
   argocd app sync argocd/edge argocd/grafana
   argocd app wait argocd/edge argocd/grafana --sync --health --timeout 900
   kubectl --context observability -n observability get pods -l app.kubernetes.io/name=edge \
     -o jsonpath='{range .items[*]}{.metadata.name} {.spec.readinessGates[*].conditionType}{"\n"}{end}'
   ```
   Every edge pod lists a `target-health.elbv2.k8s.aws/...` gate and is
   ready, which means the ALB sees it healthy. Grafana now expects
   `grafana.macro-internal.com`, which still reaches the host; its
   notifications stay muted.
3. **Baseline, then stop the host's Loki and Tempo.** First note what reaches
   the host, to compare in step 6:
   ```sh
   curl -fsS http://127.0.0.1:9090/api/v1/query --data-urlencode 'query=count by (job) ({__name__=~".+"})'
   curl -fsS http://127.0.0.1:3100/loki/api/v1/query --data-urlencode 'query=sum by (service_name) (count_over_time({service_name=~".+"}[10m]))'
   ```
   Then flush and stop. Loki's endpoint returns once its chunks are in S3;
   Tempo's answers at once and flushes in the background, so wait for its log
   line:
   ```sh
   since=$(date '+%F %T')
   curl -fsS -X POST 'http://127.0.0.1:3100/ingester/shutdown?flush=true&terminate=false'
   curl -fsS -X POST http://127.0.0.1:3200/shutdown
   timeout 900 sh -c "until sudo journalctl -u tempo --since '$since' | grep -q 'shutdown handler complete'; do sleep 5; done" \
     && hold loki tempo
   ```
   If the wait times out, stop here and read `sudo journalctl -u tempo`. Logs and
   traces sent from now until step 5 is done are lost: the time steps 4 and 5
   take.
4. **Merge *Cluster, buckets*** and sync `loki` and `tempo` at that commit,
   then wait until every pod has rolled and check they run with the host's
   buckets:
   ```sh
   merge=<the merge commit on main>
   argocd app get argocd/loki --hard-refresh >/dev/null; argocd app get argocd/tempo --hard-refresh >/dev/null
   argocd app sync argocd/loki argocd/tempo --revision "$merge"
   argocd app wait argocd/loki argocd/tempo --operation --health --timeout 1800
   for app in loki tempo; do argocd app get argocd/$app -o json |
     jq -r '[.metadata.name, .status.operationState.phase, .status.operationState.syncResult.revision] | join(" ")'; done
   # both: Succeeded $merge. Anything else, or a bucket below that isn't the host's: stop.
   kubectl --context observability -n observability get configmap loki -o yaml | grep bucketnames
   kubectl --context observability -n observability get configmap tempo-config -o yaml | grep 'bucket:'
   for w in statefulset/loki statefulset/tempo-ingester statefulset/tempo-metrics-generator \
     deployment/tempo-compactor deployment/tempo-querier deployment/tempo-query-frontend \
     deployment/tempo-distributor; do
     kubectl --context observability -n observability rollout status "$w"
   done
   ```
   Check the history is there, a week back:
   ```sh
   kubectl --context observability -n observability port-forward svc/loki 3100 &
   kubectl --context observability -n observability port-forward svc/tempo-query-frontend 3200 &
   week=$(date -d '7 days ago' +%s)
   curl -fsS -G http://localhost:3100/loki/api/v1/query --data-urlencode time=$week \
     --data-urlencode 'query=sum by (service_name) (count_over_time({service_name=~".+"}[1h]))'
   curl -fsS -G http://localhost:3200/api/search --data-urlencode start=$week \
     --data-urlencode end=$((week + 3600)) --data-urlencode limit=5
   ```
   Both list services and traces. Empty means the buckets are wrong: go back.
5. **Move the traffic.** From `infra/stacks/observability` on main, apply
   only the *listener rule* deletions (a dry run of Deploy Observability must
   have tagged main's AMI first):
   ```sh
   p=urn:pulumi:prod::observability
   targets=(--target "$p::aws:lb/listenerRule:ListenerRule::observability-hosts"
     --target "$p::aws:lb/targetGroupAttachment:TargetGroupAttachment::observability"
     --target "$p::aws:lb/targetGroup:TargetGroup::observability"
     --target "$p::aws:cloudwatch/metricAlarm:MetricAlarm::observability-ui")
   pulumi preview --stack macro-inc/observability/prod --diff "${targets[@]}"   # exactly four deletes
   pulumi up --stack macro-inc/observability/prod --diff "${targets[@]}"
   ```
   The ALB now sends `grafana.` and `otlp.macro-internal.com` here. At once,
   on the host, `hold grafana`: its rules now see no new data and would page.
6. **Check, then let this Grafana notify.** Sign in at
   https://grafana.macro-internal.com. After about 10 minutes, Explore on
   `prometheus` and `loki` runs the two baseline queries of step 3: the jobs
   and services that send to `otlp.` are there with fresh samples (the host's
   own scrape jobs aren't; the cluster scrapes itself). Then the `Prod alerts`
   dashboard shows rules with data and nothing firing that wasn't firing
   before. Merge *Cluster, notify* and sync `grafana`. Between step 5 and here
   no Grafana notifies; CloudWatch alarms still do. Until step 8 its GoAlert
   contact points still fail (the old host's nginx answers 404 on their path),
   so a prod Grafana alert pages nobody: only CloudWatch alarms (through SNS)
   and the watchdog still alert (Grafana's SNS route is for dev alerts). From step 5 until
   step 8's contact point check passes, someone watches the cluster Grafana's
   firing alerts (Alerting, Alert rules) and pages by hand; run steps 7 and 8
   back to back.
7. **Copy the metrics history into Mimir.** On the host, start `sudo bash -euo
   pipefail` (any failing command then ends it before the next runs), paste
   `hold`, and take a snapshot with Prometheus' own binary (the service has no
   admin API), check it, then copy it:
   ```sh
   prom=$(systemctl show -p ExecStart --value prometheus | grep -o '/nix/store/[^ ]*/bin/prometheus' | head -1)
   test -x "$prom"
   data=/srv/observability/prometheus/data
   hold prometheus
   printf 'global: {}\n' > /run/snapshot-prometheus.yml
   sudo -u prometheus "$prom" --config.file=/run/snapshot-prometheus.yml \
     --storage.tsdb.path="$data" --storage.tsdb.retention.time=1y \
     --web.listen-address=127.0.0.1:9091 --web.enable-admin-api >/run/snapshot-prometheus.log 2>&1 &
   timeout 900 sh -c 'until curl -fsS http://127.0.0.1:9091/-/ready; do sleep 5; done' # WAL replay
   name=$(curl -fsS -X POST http://127.0.0.1:9091/api/v1/admin/tsdb/snapshot | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
   pkill -f -- '--web.listen-address=127.0.0.1:9091'
   echo "snapshot: ${name:?no snapshot}"
   ls "$data/snapshots/$name"                  # block directories, 01...
   aws s3 sync --region us-east-2 "$data/snapshots/$name/" s3://macro-observability-k8s-mimir/blocks/anonymous/
   ```
   If the readiness wait times out, read `/run/snapshot-prometheus.log`. About
   15 minutes after the copy Grafana shows the host's 30 days of metrics,
   except its last 12 hours, which Mimir reads from blocks only once they are
   12 hours old (`query_store_after`). Then set `mimirBackfill.enable = false`
   in `../aws/` and apply.
8. **Deploy the GoAlert-only host**: follow "The GoAlert-only rollout" in
   `infra/stacks/observability/README.md`: its checks, a dry run of Deploy
   Observability, a targeted `pulumi up` of the narrowed host role (the deploy
   workflow refuses role changes), then the real run. It replaces the host,
   which also drops every `hold`.
9. **Afterwards**: remove the localhost redirect URI from the Google OAuth
   client, and set `macro.cluster.autoSync = true`.

### Going back

The cluster's Loki and Tempo leave the host's buckets before the host's run
again, every time:

1. Revert *Cluster, buckets*, and *Cluster, notify* if merged, in one change.
   With auto-sync on (step 9), first merge a separate change that sets
   `macro.cluster.autoSync = false`, wait until `apps` has applied it (every
   Application's `spec.syncPolicy` has no `automated`), and only then merge
   the revert: in one change the children could sync it before their policy
   is off, and a pinned `--revision` sync is refused while auto-sync is on. Sync `grafana` at the revert's commit and
   wait until no pod of the old ReplicaSet is left, not even terminating, so
   no Grafana that notifies is running when the host's starts:
   ```sh
   argocd app wait argocd/grafana --operation --health
   k="kubectl --context observability -n observability"
   hash=$($k get deployment grafana -o jsonpath='{.metadata.annotations.deployment\.kubernetes\.io/revision}')
   rs=$($k get rs -l app.kubernetes.io/name=grafana -o json |
     jq -r --arg rev "$hash" '.items[] | select(.metadata.annotations["deployment.kubernetes.io/revision"] == $rev) | .metadata.labels["pod-template-hash"]')
   if [ -n "$rs" ] && [ "$(printf '%s\n' "$rs" | wc -l)" -eq 1 ]; then
     until pods=$($k get pods -l "app.kubernetes.io/name=grafana,pod-template-hash!=$rs" -o name) && [ -z "$pods" ]; do sleep 5; done; echo "old Grafana pods gone"
   else echo "STOP: not one current ReplicaSet: $rs"; fi
   ```
   Then sync `loki` and `tempo` at the same commit and wait and check as in
   step 4: the buckets are `macro-observability-k8s-loki` and
   `macro-observability-k8s-tempo` again. Then check no pod of the old
   revision is left, not even terminating: `kubectl --context observability
   -n observability get pods -l 'app.kubernetes.io/name in (loki,tempo)'`
   shows only pods younger than the sync.
2. **If step 8 narrowed the host role but didn't replace the host**, widen
   the role again first: the targeted `pulumi up` of `observability-storage`
   (`infra/stacks/observability/README.md`, "Deploying") from a checkout with
   the full host's role and a tagged AMI, such as the commit the running host
   was built from, so the held services have their permissions when released.
   Then go on as "Otherwise" below.
   **If step 8 deleted the old host** (whether or not its replacement came up),
   put the full host back on main (the *host
   image* and *host role* parts of `infra/stacks/observability` as they were before the
   switch) and deploy it as "Going back to the full host" in
   `infra/stacks/observability/README.md` says: widen the role with the
   targeted `pulumi up`, then Deploy Observability, dry run first. The new
   host starts all its services.
   **Otherwise** (the original host still runs), on it: `release loki tempo grafana prometheus` (the
   ones held so far).
3. **If step 5 ran**, put the *listener rule*, target group, attachment and
   alarm back in `infra/stacks/observability/index.ts` on main, then preview
   and apply them by hand with the same `--target`s as step 5, so the ALB
   sends both names to the host again. Revert *Cluster, public* if Grafana
   should be tested at localhost again.

Logs, traces and metrics written to the cluster in the meantime stay there:
metrics in Mimir's own bucket, and logs and traces in the host's buckets but
with the cluster's index, which the host's Loki and Tempo may not list.

## Why it's built this way

- **Rendered YAML is committed.** Argo CD needs no Nix, and a reviewer sees
  exactly what changes on the cluster. CI fails when it is stale.
- **cert-manager for the load balancer controller's webhook.** The chart
  otherwise generates a new CA on every render, so the committed YAML would
  never match a fresh render.
- **CRD schemas without descriptions or examples.** They mean nothing to the
  API server and made up most of the YAML.
- **Alloy in its own namespace.** It mounts host paths, which the
  `observability` namespace's Pod Security level (baseline) forbids. It
  mounts only `/proc`, `/sys` and `/var/log` read-only, plus its own data
  directory: with the node's whole root it could read every pod's service
  account token, so the filesystem collector is off.
- **Grafana's provisioning in its own ConfigMaps, not chart values.** The
  chart runs datasource and alerting values through Helm's `tpl`, which
  would evaluate the alert annotations' own Go templates.
- **The edge answers the ALB's health check itself.** A Grafana outage then
  shows as 5xx on the target group instead of taking the OTLP host down with
  it, since both hosts share the edge.
- **Grafana's plugins come from grafana.com at startup** (`preinstall_sync`,
  pinned versions, no auto-update): the image has none, and the host's come
  from nixpkgs.
