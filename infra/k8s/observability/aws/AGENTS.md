# observability cluster: AWS layer

## What it is

The AWS side of the observability EKS cluster (us-east-2): subnets, EKS, nodes,
add-ons, Pod Identity roles, buckets, Grafana's RDS, ALB target groups, and the listener rules and alarms that the
switch adds. OpenTofu written in Nix with terranix, in its own
flake. `README.md` has what each module creates and the apply steps.

## Start here

- `settings.nix`: every name, size and hostname; the contract with `../cluster`.
- `modules/existing.nix`: what is read from the Pulumi `observability` stack.
- `flake.nix`: the rendered configs (`main`, `bootstrap`), the `tofu` and
  `bootstrap` apps, and the `validate` check.

## Scope

- Owns: AWS resources the cluster needs. Kubernetes objects → `../cluster`.
- Not here: the VPC, ALB, listener, zone, alarm topic and host →
  `infra/stacks/observability` (Pulumi). Read them as data sources; never
  import, change or replace them.

## Recipes

- Change a value: edit `settings.nix`, not a module.
- Add a Pod Identity service account: `settings.serviceAccounts` → its
  statements in `policies` (`modules/pod-identity.nix`) → the README contract
  and the cluster layer's ServiceAccount.
- Write references with `lib.tf.ref "aws_x.name.attr"`; IAM documents with
  `builtins.toJSON`. Generate repeated resources with Nix (`lib.mapAttrs`), not
  `count`; `for_each` only over a tofu variable.

## Checks

From this directory:
- `nix flake check` (renders, `tofu validate`s each config offline, refuses
  secret-bearing resources and arguments). CI runs it (`Observability AWS layer`).
- `nix fmt -- <changed .nix files>`
- New files must be `git add`ed before Nix sees them.

## Gotchas

- Agents never run `tofu apply`, `nix run .#bootstrap` or anything that writes
  to AWS; `plan` is fine with read credentials. Every apply needs the user's
  go-ahead.
- No secret values in config or state: no `password`, `secret_string` or
  `aws_secretsmanager_secret_version`; let the AWS service own the secret
  (`manage_master_user_password`) and grant its ARN.
- Default tags use `project = observability-k8s`. Never tag a resource
  `project = observability`: `existing.nix` finds the Pulumi VPC and ALB by
  that tag and a second match breaks every plan.
- Listener rule priorities 1 and 2 belong to Pulumi. The switch needs that
  stack's rule to drop the hostnames, not a lower priority here.
- Pod Identity roles trust session tags (cluster, namespace, service account);
  don't disable session tags on an association.
- Buckets and RDS have `prevent_destroy`; a plan that replaces one is an error
  by design.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Docs: `README.md`,
  `infra/stacks/observability/README.md`, `docs/development/infrastructure.md`
