reachable only from the cluster security group; its RDS-managed password rotates once a year (first Sunday of January, 04:00–05:00 UTC) instead of every 7 days. |# Observability cluster: AWS layer

The AWS resources for the observability EKS cluster in Ohio (us-east-2), in
OpenTofu written in Nix with [terranix](https://terranix.org). It is the first
of the two layers that move Grafana, Loki, Tempo, Mimir and Alloy ingest off
the single NixOS host in [`infra/stacks/observability`](../../../stacks/observability/README.md);
what runs inside the cluster is `../cluster` (nixidy, applied by Argo CD; added
by its own pull request).

Nothing here is applied by CI. Every `tofu apply` is run by hand, after
approval, with the steps under [First apply](#first-apply).

## What it creates

| File | Resources |
| --- | --- |
| `bootstrap/state.nix` | The state bucket `macro-observability-k8s-tofu-state`: versioned, encrypted, private, TLS only. Holds the state of both configs. |
| `modules/network.nix` | Private subnets in us-east-2b (`10.88.16.0/20`) and 2c (`10.88.32.0/20`), on the stack's private route table (its single NAT and S3 gateway endpoint). |
| `modules/eks.nix` | EKS cluster `observability` (API access entries only, public endpoint limited to given CIDRs, control-plane logs 30 days, standard support only), a managed node group of 3 × m7g.large on AL2023 across 2a/2b/2c, add-ons VPC CNI (network policy on), kube-proxy, Pod Identity agent, CoreDNS, EBS CSI, and cluster-admin access entries. |
| `modules/pod-identity.nix` | One role per service account (below), bound with Pod Identity. |
| `modules/buckets.nix` | Buckets `macro-observability-k8s-{loki,tempo,mimir}`, configured as the host's buckets. |
| `modules/rds.nix` | Grafana's Postgres 17, db.t4g.micro, Multi-AZ, 20 GiB gp3, reachable only from the cluster security group. |
| `modules/edge.nix` | IP target groups `obs-k8s-grafana` and `obs-k8s-otlp`, listener rules for `grafana-next.` / `otlp-next.macro-internal.com`, an ACM certificate for both added to the listener, their DNS records, and the security group rules ALB → pods on port 8080. |
| `modules/alarms.nix` | Per target group: no healthy target, and target 5xx. To the stack's alarm topic, with notifications off until cutover (`settings.alarms.notify`). |
| `modules/outputs.nix` | Names and ARNs the cluster layer needs; `nix run .#tofu -- main output`. |

`settings.nix` holds every value; change it there, not in the modules.

### Read from the Pulumi stack, never changed

`modules/existing.nix` looks up, as data sources, the VPC and ALB (by their
`project`/`environment` tags), the 2a private subnet (by CIDR), the NAT and
the private route table, the HTTPS listener, the `macro-internal.com` zone, the
`observability-prod-alerts` topic and the `observability/prod` secret
(metadata only). OpenTofu only adds resources next to them: route table
associations, two listener rules (priorities 10 and 11; Pulumi has 1 and 2), a
listener certificate, DNS records, and one egress rule on the ALB's security
group, which, like the stack's own `observability-alb-to-host` rule, Pulumi
does not manage inline. Nothing in this layer changes how the host is served.
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
Manager describe) and the state bucket.

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
3. Say who gets cluster admin and which addresses reach the API. The role is
   the IAM role behind your credentials, with its path (for IAM Identity Center:
   `aws iam list-roles --path-prefix /aws-reserved/sso.amazonaws.com/ --query 'Roles[].Arn'`):
   ```sh
   export TF_VAR_admin_principal_arns='["arn:aws:iam::569036502058:role/<path>/<role>"]'
   export TF_VAR_public_access_cidrs='["<your public IP>/32"]'
   ```
4. Plan and review. Expect only additions (82) and no change or
   destroy:
   ```sh
   nix run .#tofu -- main init
   nix run .#tofu -- main plan -out=tfplan
   ```
5. Apply that plan:
   ```sh
   nix run .#tofu -- main apply tfplan
   ```
6. Check, from `nix develop` (it has `kubectl`):
   ```sh
   aws eks update-kubeconfig --region us-east-2 --name observability
   kubectl get nodes -L topology.kubernetes.io/zone   # 3 Ready, one per zone
   kubectl get pods -n kube-system                     # aws-node, kube-proxy, coredns, ebs-csi, pod identity agent Running
   nix run .#tofu -- main output
   ```
   `grafana-next` and `otlp-next` answer 503 until the cluster layer's edge
   nginx registers targets, and their alarms sit in `ALARM` without notifying.

Later applies are steps 3 to 5.

## Removing it

Buckets and the database have `prevent_destroy`, and the database also has
deletion protection, so `tofu destroy` stops on them. To remove everything,
take those guards out in a reviewed change first; destroying the database
leaves a final snapshot `observability-grafana-final`.
