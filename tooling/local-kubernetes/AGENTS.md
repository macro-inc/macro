# Local Kubernetes

## What it is

Runs the canonical local Compose service definitions as Deployments and Services
on one Nix-declared kind node. This is a local development runtime only.

## Start here

- `run.py`: ownership, cluster lifecycle, Compose conversion, initialization.
- `nix/local-kubernetes.nix`: pinned tools and node configuration.
- `xtask_local/src/local/kubernetes.rs`: shared local initialization.

## Scope

- Owns only `macro-eks-local`, its checkout-owned network and
  `macro-kube-<name>` namespaces annotated with this checkout path.
- Generated state and manifests belong in `infra/local/generated/`, never git.
- Keep Compose as the service, image, env, route and backing-container inventory.

## Checks

- `python3 -m unittest discover -s tooling/local-kubernetes -p 'test_*.py'`
- `python3 -m py_compile tooling/local-kubernetes/run.py`
- Exercise both namespaces, passwordless login and document creation before
  claiming a working full stack; TCP readiness alone is insufficient.

## Gotchas

- Namespace deletion deletes its data; `stop` preserves PVCs.
- Always pass the private kubeconfig and explicit context; never use the user's
  current Kubernetes context.
- The two fixed HTTPS slots are 32443 and 32444; initialization forwards bind
  loopback temporarily and must be serialized.
