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
- `modules/backends/endpoints.nix`: how other modules reach Loki, Tempo and Mimir.
- `modules/grafana.nix`, `modules/edge.nix`, `modules/ingest.nix`: Grafana, the
  two nginx front doors and Alloy ingest, built from the host stack's files
  (README, "Grafana, the edge and ingest").

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
- Route the node Alloy's telemetry: `macro.alloyNode`, set in `modules/backends/default.nix`
  (options in `modules/platform/alloy-node.nix`).
- Reach a backend from a new component: import `modules/backends/endpoints.nix` and
  label the pods with its `clientLabels` (`write` or `read`); the backends' policies
  admit nothing else.
- Let the cluster Grafana notify (the switch only, README "The switch"): `macro.grafana.notify = true`
  in `env/prod.nix`. Until then only the watchdog heartbeat sends.
- Start Grafana: set `macro.grafana.database` in `env/prod.nix` from the
  `../aws/` outputs; it runs 0 replicas until then.
- Change an edge or query-gateway rule: `modules/edge.nix`.

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
- The backends take retention, limits and features from the single host's
  `infra/stacks/observability/nixos/backend-config.nix`: a change there changes this
  render too, so re-render and commit both.
- Backend replicas spread one per zone with `DoNotSchedule`, and there is one node
  per zone: a replica whose node is gone stays Pending until its zone has a node
  again, rather than doubling up in another zone (its gp3 volume is zonal anyway).
- Mimir is hand-written (`modules/backends/mimir.nix`), not a chart: bump its image
  there, and its push path is `/api/v1/push`, not Prometheus' `/api/v1/write`.
- A change to the host's `nixos/grafana.nix`, `nixos/grafana-provisioning/` or
  `nixos/ingest.alloy` changes this render; re-render with it.
- Grafana's contact point **Test** button sends even while `notify` is false.
- Argo CD syncs with server-side apply; ignore a field (`ignoreDifferences`) only
  after seeing it drift on a cluster.

## Related

- Rules: `.agents/rules/infra/github-workflows.md` · Docs: `docs/development/infrastructure.md`
