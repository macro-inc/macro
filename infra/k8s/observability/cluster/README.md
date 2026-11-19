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

Charts are pinned in `charts/<repo>/<chart>/default.nix` (version and hash).

## Commands

Run from this directory.

| Command | What it does |
| --- | --- |
| `nix run .#render` | Renders the modules into `manifests/prod/`. Commit the result with the change. |
| `nix run .#check` | Fails when `manifests/prod/` differs from a fresh render, then validates. CI runs this (`observability_cluster.yml`). |
| `nix run .#validate` | Validates the manifests strictly with kubeconform: core kinds against the Kubernetes schemas for the cluster's version, custom resources against the CRDs being installed. |
| `nix run .#kind-smoke` | Bootstraps the pushed branch onto a throwaway kind cluster and waits for the applications. Every application must sync and all must be healthy except `aws-load-balancer-controller` and `external-secrets`, which need AWS (VPC lookup, the ClusterSecretStore). Pass `--delete` to remove the cluster afterwards. |
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
  | `external-secrets` | `external-secrets` | read `observability/prod` |
  | `observability` | `loki`, `tempo`, `mimir`, `grafana` | their buckets, later PRs |

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
