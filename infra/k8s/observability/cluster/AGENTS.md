# infra/k8s/observability/cluster

## What it is

What runs on the observability EKS cluster, as nixidy modules rendered to
`manifests/prod/`, which Argo CD applies from `main`. Merging here deploys (with
`macro.cluster.autoSync` off, at the next manual sync in Argo CD).
The [README](README.md) has the application list, bootstrap and contract with
`../aws/` (OpenTofu, its own flake).

## Start here

- `modules/cluster.nix`: cluster facts (`macro.cluster`) and the defaults every Application gets.
- `modules/platform/observability-namespace.nix`: the default-deny pattern new components follow.
- `env/prod.nix`: the Git target and prod values.

## Scope

- Owns: Kubernetes objects on the cluster, Argo CD, chart pins.
- Not here: the cluster, IAM, Pod Identity associations, buckets → `../aws/`.
  The current single-host stack → `infra/stacks/observability`.

## Recipes

- Change anything: edit `modules/`, then `nix run .#render` and commit
  `manifests/prod/` with it. Never edit `manifests/prod/` by hand.
- Bump a chart: change `version` in `charts/<repo>/<chart>/default.nix`, set
  `chartHash` to `""`, build `.#prod`, copy the hash from the error, render.
- Add a component: a module imported from `modules/default.nix`, as its own
  Application in `observability`, with its own NetworkPolicies (README,
  "Adding a component").
- Route the node Alloy's telemetry: `macro.alloyNode` in `modules/platform/alloy-node.nix`.

## Checks

- `nix run .#check`: render matches `manifests/prod/` and validates (CI runs it).
- If a module or chart changed: `nix run .#kind-smoke` (needs the branch pushed).
- `nix fmt` for `.nix` files.

## Gotchas

- Renders must be deterministic, or the drift check fails on every PR. A chart
  that generates certificates or random values at template time needs them
  turned off (the load balancer controller uses cert-manager for this).
- Never run `bootstrap`, `kubectl apply` or any `tofu` command against the prod
  cluster without the user's go-ahead for that action.
- The `observability` namespace enforces Pod Security `baseline`; pods that mount
  host paths go in their own namespace, as `alloy-node` does.
- Pod Identity matches service account names exactly; they are fixed by `../aws/`
  (README, "What `../aws/` must provide").
- Applications have no resources finalizer: deleting a module removes its
  Application but leaves its workloads running; delete those by hand.
- `kubernetesVersion` in `env/prod.nix` matches the cluster version in `../aws/`;
  Helm renders and kubeconform validates for it.
- CI checks the render against `main` as of the run. If another change to this
  directory merges first, re-render on the new `main` before merging.
- Argo CD syncs with server-side apply; ignore a field (`ignoreDifferences`) only
  after seeing it drift on a cluster.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Docs: `docs/development/infrastructure.md`
