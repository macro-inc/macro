# Observability cluster contents

Everything that runs on the observability EKS cluster (`observability`,
us-east-2), written as [nixidy](https://github.com/arnarg/nixidy) modules and
rendered to plain YAML under `manifests/prod/`. Argo CD on the cluster reads
`manifests/prod/` from `main` and applies it, so merging a change here deploys
it. The cluster itself, its IAM and the Pod Identity associations are
OpenTofu under `../aws/` (added in its own pull request).

```
modules/*.nix ──nix run .#render──▶ manifests/prod/ (committed) ──main──▶ Argo CD ──▶ cluster
```

## What runs

| Application | Namespace | What it is |
| --- | --- | --- |
| `apps` | `argocd` | The app of apps: one Application per directory below. Applied once by hand (bootstrap); it is in `apps/` itself, so from then on it manages itself too. |
| `argocd` | `argocd` | Argo CD, managing itself. Every Application syncs with prune and self-heal, automatically once `macro.cluster.autoSync` is on (below). |
| `cert-manager` | `cert-manager` | Issues the load balancer controller's webhook certificate. |
| `aws-load-balancer-controller` | `kube-system` | Registers pods in ALB/NLB target groups (`TargetGroupBinding`). Creates no load balancers: no IngressClass, Service controller, Service mutator or Ingress validation, and its role can only register targets. |
| `external-secrets` | `external-secrets` | External Secrets Operator and the `secrets-manager` ClusterSecretStore over the Secrets Manager secret `observability/prod`. Only cluster admins can create stores (namespace `edit` and `admin` can't), since a store without credentials reads with the operator's. |
| `storage` | `kube-system` | The default `gp3` StorageClass (EBS CSI, encrypted, expandable). |
| `observability-namespace` | `observability` | The namespace the backends and Grafana run in, default-deny NetworkPolicies and the policies they share. |
| `alloy-node` | `alloy` | One Alloy per node for the cluster's own node, kubelet, cAdvisor and pod-log telemetry. Collects and drops until the backends land. |
| `reloader` | `observability` | Restarts a Deployment when a Secret it names in `secret.reloader.stakater.com/reload` changes (Grafana's rotated database password). |
| `grafana` | `observability` | Grafana, two replicas on RDS Postgres with HA alerting between them, provisioned from the host's `nixos/grafana-provisioning`. Sends no notification until cutover, except the watchdog heartbeat (below). |
| `edge` | `observability` | nginx, the only target of the ALB: Grafana by hostname, OTLP to `alloy-ingest`, basic-auth remote write and Loki push. Runs only in the ALB's zones. |
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
| `nix run .#kind-smoke` | Bootstraps the pushed branch onto a throwaway kind cluster and waits for the applications. Every application must sync and be healthy except those that need AWS: `aws-load-balancer-controller` (VPC lookup), `external-secrets` (the ClusterSecretStore), `grafana`, `edge` and `alloy-ingest` (their secrets); `edge` may also stay unsynced (its TargetGroupBindings need the controller's webhook). Pass `--delete` to remove the cluster afterwards. |
| `nix run .#bootstrap -- --context <ctx>` | The one-time bootstrap below. |

## Bootstrap (once, after the cluster exists)

Argo CD can't install itself on an empty cluster. Once `../aws/` has created the
cluster and its Pod Identity associations, and this directory is on `main`, run
this from a clean checkout of `main` (the script refuses anything else):

```sh
aws eks update-kubeconfig --name observability --region us-east-2 --alias observability
nix run .#bootstrap -- --context observability
```

`bootstrap` installs Argo CD from `manifests/prod/argocd/` with server-side apply
as Argo CD's own field manager, waits for it, and applies
`manifests/prod/apps/Application-apps.yaml`. From then on Argo CD syncs
everything from `main`, Argo CD and the `apps` Application included; nothing is
applied by hand again.

For the first rollout `env/prod.nix` has `macro.cluster.autoSync = false`.
`apps` still syncs itself, but it holds only the Application objects; every
other application shows what it would change and applies nothing until
someone syncs it. Read each diff, then sync them in the order of the table
above (`argocd` first: until then the bootstrap's copy runs):

```sh
kubectl --context observability -n argocd get applications
kubectl --context observability -n argocd get secret argocd-initial-admin-secret \
  -o jsonpath='{.data.password}' | base64 -d
kubectl --context observability -n argocd port-forward svc/argocd-server 8080:443
# https://localhost:8080, user admin: each application's "App diff", then "Sync".
# Or with the CLI (`nix shell nixpkgs#argocd`), after
# `argocd login localhost:8080 --username admin`:
argocd app diff argocd/cert-manager
argocd app sync argocd/cert-manager
```

Once the cluster has been tested, a change sets `autoSync = true`, and merging
deploys from then on.

After the first login, change the admin password (`argocd account update-password`)
and delete `argocd-initial-admin-secret`. Any pod in the cluster can reach the
Argo CD API, and admin there controls the cluster.

The repository is public, so Argo CD clones it over HTTPS without a deploy key
(shallow, `depth: 1`). If it ever goes private, add a read-only deploy key to
`observability/prod` and an ExternalSecret for the repository Secret.

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
  | `observability` | `loki`, `tempo`, `mimir` | their buckets |
  | `observability` | `grafana` | CloudWatch read, `sns:Publish` on the alerts topic |

## Adding a component

Loki, Tempo, Mimir, Grafana, ingest and the edge each come as one module under
`modules/` imported from `modules/default.nix`, as their own Application in the
`observability` namespace. Each one:

- brings its own NetworkPolicies for its traffic: the namespace denies
  everything else. DNS is already allowed; label a pod
  `observability.macro.com/aws-apis: "true"` to let it reach AWS APIs, S3 and
  the Pod Identity agent;
- reads secrets with an `ExternalSecret` against the `secrets-manager`
  ClusterSecretStore (`config.macro.cluster.secretStore`);
- uses a service account named in the table above, so Pod Identity applies.

The metrics and logs backends also point the node Alloy at themselves through
`macro.alloyNode` (`modules/platform/alloy-node.nix` shows how).

## Grafana, the edge and ingest

```
ALB ─▶ edge ─┬─ grafana-next.* ──▶ grafana ──▶ query-gateway ──▶ Loki, Mimir, Tempo
             ├─ /v1/{traces,logs,metrics} ──▶ alloy-ingest ──▶ Loki, Tempo, Mimir
             └─ /api/v1/write, /loki/api/v1/push (basic auth) ──▶ Mimir, Loki
```

The edge, the query gateway and Alloy ingest are the host's
`infra/stacks/observability/nixos/proxy.nix` and `ingest.alloy` with the
cluster's addresses; Grafana runs the host's `grafana.nix` settings and
`grafana-provisioning`. A change to those host files changes this render too
(CI watches them).

Every one runs two replicas in different zones with a PodDisruptionBudget,
surge-first rolling updates, readiness probes and a `preStop` pause, so a
rollout or a drained node never drops traffic. The edge's pods carry the load
balancer controller's readiness gate: a new pod is ready only once the ALB
sees it healthy.

**Notifications.** Only one Grafana may notify, and until cutover that is
the host's. `macro.grafana.notify = false` (`env/prod.nix`) mutes every
notification route, so rules evaluate and show state here but nothing reaches
GoAlert, SNS or anyone. The one exception is the watchdog: an always-firing
rule that pings a GoAlert heartbeat monitor every two minutes, so GoAlert pages if
this Grafana, its alerting or its path to GoAlert stops. Cutover sets
`notify = true`. Muting covers notification policies only: a contact point's
**Test** button in the UI sends for real even while muted; don't press it
before cutover.

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
2. **Google sign-in** (a Google Workspace admin): add
   `https://grafana-next.macro-internal.com/login/google` as an authorized
   redirect URI of the OAuth client the host's Grafana uses.
3. **Watchdog** (a GoAlert admin): create a heartbeat monitor on the
   observability service, timeout 5 minutes, and put its ID as
   `goalert_cluster_heartbeat_id` in Doppler `observability/prd` and Secrets
   Manager `observability/prod`.
4. **Service accounts**: Grafana service accounts and their tokens live in the
   database, so they don't come over from the host; recreate the ones still
   in use and hand out the new tokens.

### At cutover

- The host's nginx opens `/api/v2/grafana/` on `oncall.macro-internal.com` to
  the ALB (a host change), so the GoAlert contact points can deliver.
- `macro.grafana.notify = true`, and the host's Grafana stops notifying in the
  same window.
- `grafana.macro-internal.com` and `otlp.macro-internal.com` join
  `macro.edge.grafanaHosts` / `otlpHosts`, `macro.grafana.hostname` becomes
  `grafana.macro-internal.com` (and its Google redirect URI is already
  registered), and the ALB's listener rules move to the target groups.

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
