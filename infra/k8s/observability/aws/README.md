# Observability cluster: AWS layer

The AWS resources for the observability EKS cluster in Ohio (us-east-2), in
OpenTofu written in Nix with [terranix](https://terranix.org). It is the first
of the two layers that move Grafana, Loki, Tempo, Mimir and Alloy ingest off
the single NixOS host in [`infra/stacks/observability`](../../../stacks/observability/README.md);
what runs inside the cluster is `../cluster` (nixidy, applied by Argo CD).

Nothing here is applied by CI. Every `tofu apply` is run by hand, after
approval, with the steps under [First apply](#first-apply).

## What it creates

| File | Resources |
| --- | --- |
| `bootstrap/state.nix` | The state bucket `macro-observability-k8s-tofu-state`: versioned, encrypted, private, TLS only. Holds the state of both configs. |
| `modules/network.nix` | Private subnets in us-east-2b (`10.88.16.0/20`) and 2c (`10.88.32.0/20`), on the stack's private route table (its single NAT and S3 gateway endpoint). |
| `modules/eks.nix` | EKS cluster `observability` (API access entries only, public endpoint limited to given CIDRs, control-plane logs 30 days, standard support only), a managed node group of 3 × m7g.large on AL2023 across 2a/2b/2c, add-ons VPC CNI (network policy on), kube-proxy, Pod Identity agent, CoreDNS, EBS CSI, and one cluster-admin access entry, for the role `observability-eks-admin` ("Cluster access"). |
| `modules/pod-identity.nix` | One role per service account (below), bound with Pod Identity. |
| `modules/buckets.nix` | Buckets `macro-observability-k8s-{loki,tempo,mimir}`, configured as the host's buckets. Loki and Tempo use theirs while the cluster is tested and move to the host's at the switch; Mimir keeps its own. |
| `modules/rds.nix` | Grafana's Postgres 17, db.t4g.micro, Multi-AZ, 20 GiB gp3, reachable only from the cluster security group; its RDS-managed password rotates once a year (first Sunday of January, 05:00–06:00 UTC) instead of every 7 days. |
| `modules/edge.nix` | IP target groups `obs-k8s-grafana` and `obs-k8s-otlp` and the security group rules ALB → pods on port 8080. At the switch (`settings.switched`), listener rules for `grafana.` and `otlp.macro-internal.com` (priorities 10 and 11). |
| `modules/alarms.nix` | At the switch (`settings.switched`), per target group: no healthy target, and target 5xx, to the stack's alarm topic. |
| `modules/outputs.nix` | Names and ARNs the cluster layer needs; `nix run .#tofu -- main output`. |

`settings.nix` holds every value; change it there, not in the modules.

### Read from the Pulumi stack, never changed

`modules/existing.nix` looks up, as data sources, the VPC and ALB (by their
`project`/`environment` tags), the 2a private subnet (by CIDR), the NAT and
the private route table, the HTTPS listener, the `macro-internal.com` zone, the
`observability-prod-alerts` topic and the `observability/prod` secret
(metadata only), the host's Loki and Tempo buckets (by name prefix among the
stack's tagged buckets) and, for the Mimir backfill, the host's instance role
(through the stack's one running instance).
OpenTofu only adds resources next to them: route table associations, one
egress rule on the ALB's security group, which, like the stack's own
`observability-alb-to-host` rule, Pulumi does not manage inline, and at the
switch two listener rules (priorities 10 and 11; Pulumi has 1 and 2), plus,
while `mimirBackfill.enable` is on, a statement in Mimir's bucket policy for
the host's role. Before the switch nothing in this layer changes how the
host is served. The Loki and Tempo roles may read and write the host's
buckets from the first apply, but nothing uses that until the switch.
The cluster security group's ingress rule references the ALB's security
group, so a Pulumi change that replaces that group fails until this rule is
removed first.

## Contract with the cluster layer

- Pod Identity service accounts: `observability/{loki,tempo,mimir,grafana}`,
  `external-secrets/external-secrets`, `kube-system/aws-load-balancer-controller`,
  `kube-system/ebs-csi-controller-sa` (bound by the EBS CSI add-on). Each role
  trusts only its own namespace and service account in this cluster.
- External Secrets may read `observability/prod`, the RDS-managed Grafana
  database secret (`grafana_db_secret_arn` output) and any secret under
  `observability/k8s/` (for cluster-only secrets such as Argo CD's deploy key).
- The load balancer controller may only describe and register/deregister
  targets in the two target groups: TargetGroupBinding only, no load balancers
  or security group management. Give it `--aws-vpc-id` and `--aws-region`:
  pods can't reach the node's instance metadata (hop limit 1). The same holds
  for every AWS client in the cluster: give Loki, Tempo, Mimir and External
  Secrets the region explicitly; if the EBS CSI controller can't find it, set it
  in the add-on's configuration.
- Buckets: `buckets` has each backend's own; `host_buckets` the host's Loki
  (`logs`) and Tempo (`traces`) buckets, which the Loki and Tempo roles may also
  use. Point Loki and Tempo at `host_buckets` only at the switch, after the
  host's Loki and Tempo have stopped: two compactors on one bucket delete each
  other's blocks.
- The edge nginx Service is the only ALB target: IP targets, port 8080, health
  check `GET /healthz` → 200, one TargetGroupBinding per target group.
  The ALB is enabled only in us-east-2a and 2b (`edge_zones` output) and sends
  nothing to a target in 2c, so the edge pods need node affinity to those two
  zones, spread across both. NetworkPolicies must allow port 8080 from the
  ALB's subnets `10.88.0.0/24` and `10.88.1.0/24` (`alb_source_cidrs`): the
  VPC CNI's policies match addresses, not security groups.
- Grafana's database: `grafana_db_address`, port 5432, database and user
  `grafana`, password from the RDS-managed secret. Connect with TLS
  (`ssl_mode = require`, or `verify-full` with the RDS CA bundle): Postgres 17
  on RDS refuses unencrypted connections. RDS rotates that password
  once a year (`settings.grafanaDb.passwordRotation`, not the 7-day default),
  so Grafana must pick up a changed Secret (refresh it often, restart on change).

## Secrets

No secret value is in this config, its state, git or Nix, the same rule as the
host stack. RDS generates Grafana's database password into a secret it manages
(`manage_master_user_password`); the state holds only that secret's ARN. ACM
keeps its certificate's private key. `nix flake check` fails on any resource
type or argument that would carry a secret value (`aws_secretsmanager_secret_version`,
`password`, `secret_string`, ...).

## Working on it

From this directory:

```sh
nix flake check              # render all configs, tofu validate each (offline), secret guard
nix build .#main && jq . result   # the rendered main config
nix fmt -- $(git ls-files '*.nix')
```

`nix run .#tofu -- <main|bootstrap> <tofu arguments>` copies a rendered config
into `.tofu/<config>/` (gitignored) and runs the flake's OpenTofu there, with the
AWS provider pinned by the flake. `tofu plan` needs credentials that can read
the Pulumi stack's resources in us-east-2 (EC2, ELB, Route 53, SNS, Secrets
Manager describe, EKS add-on versions, `tag:GetResources` for the host's
buckets, IAM `GetInstanceProfile` for the backfill) and the state bucket. `ReadOnlyAccess` covers all of them.

## Preview

A plan without the state bucket, which writes nothing to AWS: review it before
the first apply. Read-only credentials are enough. Set `TF_VAR_public_access_cidrs`
from "First apply" step 3 first, then:

```sh
nix run .#tofu -- main version                 # creates .tofu/main/
echo '{"terraform":{"backend":{"local":{"path":"preview.tfstate"}}}}' > .tofu/main/override.tf.json
nix run .#tofu -- main init
nix run .#tofu -- main plan
rm -rf .tofu/main                              # before the real init
```

## First apply

Run by the operator after the go-ahead, with admin credentials for account
569036502058 and Nix. Creating the cluster takes about 15 minutes, the
Multi-AZ database up to 20.

1. Check the Kubernetes version. `settings.nix` has `1.37`; if a newer one is
   in standard support, use it:
   `aws eks describe-cluster-versions --region us-east-2 --query 'clusterVersions[].[clusterVersion,versionStatus]' --output text`
2. Create the state bucket (once). This plans 7 resources, applies them with
   local state after you answer `yes`, then moves that state into the bucket
   and confirms with a plan that shows no changes:
   ```sh
   cd infra/k8s/observability/aws
   nix run .#bootstrap
   ```
3. Say which addresses reach the API: the machines that will run `kubectl`.
   Cluster admin is not an input; it is the role in "Cluster access".
   ```sh
   export TF_VAR_public_access_cidrs='["<your public IP>/32"]'
   ```
4. Plan and review. Expect only additions (71) and no change or
   destroy:
   ```sh
   nix run .#tofu -- main init
   nix run .#tofu -- main plan -out=tfplan
   ```
5. Apply that plan:
   ```sh
   nix run .#tofu -- main apply tfplan
   ```
6. Check, from `nix develop` (it has `kubectl`), once your IAM user is tagged
   and set up as "Cluster access" says:
   ```sh
   # kubeconfig as "Cluster access" says (people: --profile; automation: --role-arn)
   kubectl get nodes -L topology.kubernetes.io/zone   # 3 Ready, one per zone
   kubectl get pods -n kube-system                     # aws-node, kube-proxy, coredns, ebs-csi, pod identity agent Running
   nix run .#tofu -- main output
   ```
   Nothing is served from the cluster yet: its target groups have no listener
   rule until the switch.

Later applies are steps 3 to 5. To upgrade Kubernetes, raise
`settings.cluster.version` by one minor version: one apply upgrades the
control plane, then the add-ons to that version's defaults and the nodes, one
at a time.

## Cluster access

Cluster admin is one IAM role, `observability-eks-admin`. Its only AWS
permission is reading this cluster; its power is its EKS access entry. Who
may assume it is an IAM tag on their IAM user, so no person is named in this
repository (`settings.cluster.adminRole`, `adminTag`):

| Tag `observability-eks` | For | Assuming needs |
| --- | --- | --- |
| `admin` | people | an MFA session |
| `automation` | agents and scripts | nothing more |

Only IAM users qualify, not roles or federated sessions: a role session can
carry tags set by whoever assumed it, while a user's tags change only through
`iam:TagUser`. That makes `iam:TagUser` the right to become cluster admin:
keep it to IAM admins, and never grant it on a user's own ARN. An IAM admin
grants and revokes access by tagging:

```sh
aws iam tag-user --user-name <user> --tags Key=observability-eks,Value=admin
aws iam untag-user --user-name <user> --tag-keys observability-eks
```

Untagging stops new sessions; one already open keeps working until it
expires, within the hour. IAM's "Revoke active sessions" doesn't end it: EKS
checks the caller with `sts:GetCallerIdentity`, which no deny policy blocks.
To cut every admin off at once, delete the role's access policy association
(`aws eks disassociate-access-policy`); the next apply restores it.

The user's own IAM policy must also allow `sts:AssumeRole` on the role
(`AdministratorAccess` does), and its address must be in
`public_access_cidrs`. Then:

- **Automation**: `aws eks update-kubeconfig --region us-east-2 --name
  observability --alias observability --role-arn <the role's ARN>` (the user
  also needs `eks:DescribeCluster`, which `ReadOnlyAccess` has).
  `kubectl` assumes the role on every call.
- **People**: a profile in `~/.aws/config` that assumes the role with MFA,
  and `update-kubeconfig` with that profile instead of `--role-arn`. The CLI
  asks for the code when its cached session runs out. Unset any exported
  `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and `AWS_SESSION_TOKEN` first:
  they override the profile, and `kubectl` then gets your user, not the role.
  ```ini
  [profile observability-eks]
  source_profile = <your profile>
  role_arn = arn:aws:iam::569036502058:role/observability-eks-admin
  mfa_serial = arn:aws:iam::569036502058:mfa/<your MFA device>
  ```
  ```sh
  aws eks update-kubeconfig --region us-east-2 --name observability \
    --alias observability --profile observability-eks
  ```

## The switch

The cluster takes over `grafana.` and `otlp.macro-internal.com` once it has been
tested through `kubectl port-forward`. The full runbook, with the host and
cluster steps, is in `infra/k8s/observability/cluster/README.md`. This layer's part:

1. Set `switched = true` in `settings.nix` and apply (steps 3 to 5). The plan
   adds two listener rules (priorities 10 and 11) and four alarms, nothing
   else. Set `mimirBackfill.enable = true` in the same change if the host is
   to copy its Prometheus history in: the plan then also changes Mimir's
   bucket policy in place, to let the host's role list and write
   `blocks/anonymous/`; turn it off again once the copy is done. No traffic
   moves: the Pulumi stack's priority-1 rule still matches both hostnames.
2. Wait until both target groups show healthy targets. The ALB health-checks a
   target group only once a listener rule uses it, so before this apply its
   targets show `unused`:
   ```sh
   for tg in obs-k8s-grafana obs-k8s-otlp; do
     arn=$(aws elbv2 describe-target-groups --region us-east-2 --names "$tg" --query 'TargetGroups[0].TargetGroupArn' --output text)
     aws elbv2 describe-target-health --region us-east-2 --target-group-arn "$arn" --query 'TargetHealthDescriptions[].TargetHealth.State' --output text
   done
   ```
3. The Pulumi stack drops its priority-1 rule for `grafana.` and `otlp.`; from
   then on the ALB sends them here. The same change removes the host's target
   group behind that rule and its `observability-ui` alarm, which would
   otherwise breach on missing data. Apply it only with the four `--target`s of
   the cluster runbook's step 5: main's stack also narrows the host role and
   replaces the host with the GoAlert-only image, and a plain `pulumi up` would
   do both before the host's Loki, Tempo and Prometheus are drained.

Going back is more than restoring the Pulumi rule once Loki and Tempo use the
host's buckets: the cluster runbook's "Going back" stops the cluster's Loki
and Tempo before the host's start again. This layer can stay switched.

## Removing it

Buckets and the database have `prevent_destroy`, and the database also has
deletion protection, so `tofu destroy` stops on them. To remove everything,
take those guards out in a reviewed change first; destroying the database
leaves a final snapshot `observability-grafana-final`.
