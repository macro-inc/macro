# Local Kubernetes

## What it is

Runs the canonical local Compose service definitions as Deployments and Services
on one Nix-declared kind node. This is a local development runtime only.

## Start here

- `run.py`: ownership, cluster lifecycle, Compose conversion, initialization.
- `nix/local-kubernetes.nix`: pinned tools and node configuration.
- `local.env.example`: explicit stub provider metadata for offline smoke tests.
- `xtask_local/src/local/kubernetes.rs`: shared local initialization.

## Scope

- Owns only `macro-eks-local`, its checkout-owned network and
  `macro-kube-<name>` namespaces annotated with this checkout path.
- Optional build scratch is recorded with checkout ownership in `scratch.json`;
  mount it into the node before starting instances.
- Generated state and manifests belong in `infra/local/generated/`, never git.
- Keep Compose as the service, image, env, route and backing-container inventory.

## Checks

- `python3 -m unittest discover -s tooling/local-kubernetes -p 'test_*.py'`
- `python3 -m py_compile tooling/local-kubernetes/run.py`
- Exercise both namespaces, passwordless login and document creation before
  claiming a working full stack; TCP readiness alone is insufficient.

## Gotchas

- Namespace deletion deletes its data; `stop` preserves PVCs.
- Keep worker configuration and Wrangler state in namespace-local volumes even
  when worker source code is mounted from the checkout.
- Mount the Docker socket into the owned kind node for local agent sandboxes.
- Always pass the private kubeconfig and explicit context; never use the user's
  current Kubernetes context.
- The two fixed HTTPS slots are 32443 and 32444; initialization forwards bind
  loopback temporarily and must be serialized.
- `measure.py` records raw JSONL timings, host pressure, gateway transfer latency
  and runtime resource samples. Keep browser page-load timings separate from HTML
  transfer times; never invent missing runs or silently compare different commits.
