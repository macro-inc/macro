# Kubernetes environments

`cargo x env` runs a complete Macro environment in one Kubernetes namespace:
Postgres, Redis, Kafka, OpenSearch, LocalStack, FusionAuth, Mailpit, every Rust
service and worker, the Node/Workers services, the Caddy proxy, and the static
frontend. Use it to demo a branch, share a feature with someone who isn't on your
machine, or run several isolated stacks at once.

There are two cluster targets. Both install the same chart with the same values:

| Target | Cluster | URL |
| --- | --- | --- |
| `kind` (default) | A local kind cluster, `macro-envs`, created on first use | `https://<name>.localhost:9443/app/` |
| `eks` | The shared `macro-environments` cluster (`infra/stacks/environments-cluster`) | `https://<name>.env.macro-internal.com/app/` |

## Use it

Run these inside `nix develop`, which provides `kind`, `kubectl`, and `helm`:

```bash
just env up demo                 # create or update `demo` on the local kind cluster
just env up demo --target eks    # the same environment on EKS, for demos
just env list [--target eks]
just env down demo [--target eks]
```

`up` builds the service binaries, the static frontend, and the service images.
It then installs the infra, runs the same provisioning as `just run_local`
(migrations, LocalStack resources, Kafka topics, the FusionAuth kickstart,
OpenSearch indices), and installs the services. Re-running `up` updates the
environment in place. Images are tagged by content, so unchanged services keep
their pods, and data survives. `down` deletes the namespace and its volumes.

Sign in with any email address. The login code arrives in the environment's
Mailpit at `<origin>/mailpit/`.

On kind, trust `infra/local/certs/ca.pem` once, as for the local stack. EKS
environments use a public ACM certificate.

Configuration follows the local stack: Doppler `lcl_personal` when you are
logged in to Doppler, otherwise the code-defined stubs (`--no-doppler`). Add
real integration keys with `--env-file`. An EKS environment is reachable by
anyone who has its URL, so put only keys you are willing to expose in a demo
into it. Use `--no-doppler` for anything public-facing.

## How it works

The environment is rendered from the local stack's own definition, so the two
cannot drift:

1. `up` runs the same preparation as `just stack up`, for the instance
   `env-<name>`. That covers the resolved env, the compose override, the
   FusionAuth kickstart (which also authorizes the environment's public
   origin), and the static frontend. The Caddyfile uses
   `proxy::Flavor::Kubernetes`: plain HTTP on `:8080`, with TLS terminated at
   the cluster ingress.
2. `docker compose config --format json` resolves the full compose project.
   `xtask_local`'s `k8s/render.rs` translates it into workloads for the
   generic chart `infra/k8s/macro-env`:
   - each service becomes a Deployment, plus a Service with its DNS-1035 name
     and one per network alias;
   - healthchecks become readiness probes;
   - named volumes become PVCs;
   - small bind mounts become ConfigMaps;
   - large bind mounts (the frontend bundle, source trees) are baked into the
     image;
   - the shared env file becomes the `macro-env` Secret.
3. The Rust binaries are stripped and copied into one `services` image on top
   of the runtime image. Compose `build:` services are built from their own
   Dockerfiles. Services that mount the whole checkout are rebuilt with
   `docker/k8s/workspace-bake.Dockerfile`.
4. Images are loaded into kind or pushed to the `macro-env` ECR repository.
   Then `helm upgrade --install` runs into namespace `macro-<name>`.

To change what an environment runs, change the local stack: the inventory,
`docker/docker-compose*.yml`, or `local_env.rs`. Both targets pick the change up.

## Differences from the local stack

- The agent harness has no host Docker socket. Sandboxes need the Daytona
  provider (`DAYTONA_API_KEY`).
- `--with-cf-tunnel`, the headless Chrome, and the trace collectors are not
  part of an environment.
- Lambdas run as their local workers, as in `run_local`.

## The EKS cluster

`infra/stacks/environments-cluster` (dev stack only) holds:

- an EKS cluster in the shared VPC, with a managed node group;
- the EBS CSI driver and a default `gp3` StorageClass;
- Traefik behind an internet-facing NLB that terminates TLS with a wildcard
  ACM certificate;
- the `*.env.macro-internal.com` DNS record;
- the `macro-env` ECR repository, which expires images after 14 days.

Environments get their own databases and queues, so they share nothing with
dev or prod. Developers reach the cluster by assuming the
`macro-environments-developer-dev` role. `cargo x env` passes that role to
`aws eks update-kubeconfig`. The stack is deployed manually, like the other
dev-only stacks.
