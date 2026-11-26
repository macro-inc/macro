# firecracker-host stack

## What it is

One GCP host for Firecracker computers: the instance (nested virtualization
on a VM shape, or bare metal), its one durable disk (the ZFS pool every
computer lives on), a static external address, a VPC with ingress only from
IAP SSH, the control plane and the WireGuard gateway, and a service account
that can write logs and metrics and nothing else. NixOS goes on afterwards
with nixos-anywhere ([provisioning guide](../../../docs/guides/firecracker-host-provisioning.md));
the host's software is `nix/hosts/_nixos/firecracker-host.nix`.

It is the only GCP stack: every other stack is AWS. Firecracker hosts need
KVM (nested virtualization or bare metal); they run in GCP like the computer
hosts before them, or on Hetzner with no stack, and reach the AWS control
plane over WireGuard.

## Start here

- `index.ts`: the whole stack.
- `Pulumi.dev.yaml`, `Pulumi.prod.yaml`: the two bare-metal hosts
  (`c3-highcpu-192-metal`; fallbacks `c3-standard-192-metal`,
  `c4-standard-288-metal`, or `nested` on n2 with a pd-ssd), Hyperdisk
  Balanced pools. Dev allows the dev harness's egress on the agent port;
  prod has no API source yet. Whether a host takes computers (its host row,
  `admitting`) is set in the control plane, not here.

## Checks

From `infra/`: `bun run check`, `bunx biome check stacks/firecracker-host`.
Preview without touching Pulumi Cloud or GCP state, from this directory:

```sh
export PULUMI_BACKEND_URL=file://$TMPDIR/firecracker-host-state PULUMI_CONFIG_PASSPHRASE=preview-only
export GOOGLE_OAUTH_ACCESS_TOKEN=$(gcloud auth print-access-token)
pulumi stack select dev --create && pulumi preview --stack dev --diff
git checkout Pulumi.dev.yaml   # stack select writes an encryption salt into it
```

## Gotchas

- Deploys are manual and need explicit approval; the stack is deliberately
  not in `services-config.json`. One stack per host: copy `Pulumi.dev.yaml`
  with another `hostName`; every resource is named after it.
- `hostKind` must match `machineType`: `metal` only with a `-metal` shape
  (Hyperdisk only for boot and durable disks, IDPF NIC, `TERMINATE` on
  maintenance; `gcp.nix` loads `nvme` and `idpf` in the initrd), `nested`
  with any other shape (live-migrates).
- The durable disk is `protect`ed and the instance has deletion protection:
  removing either from the stack fails until protection is lifted on purpose.
  The disk outlives the instance; a replacement host imports its pool.
- `controlPlaneSources` serves the agent API on the NIC (dev only, finding
  S-17). Production hosts leave it empty, set `tunnelGatewaySources`, and run
  the module's `tunnel`.
- The installer image is ignored after creation: nixos-anywhere replaces it.
- The WireGuard gateway the tunnel peers with is not in this stack. The dev
  one (`computers-dev-gateway`, an EC2 instance routing the dev VPC to
  `10.99.0.0/24`) is removed with Incus; production hosts are blocked on a
  gateway stack of the same shape in the control plane's VPC, whose Elastic
  IP goes in `tunnelGatewaySources`.
- `agentPort` and `tunnelPort` default to the module's `port` and
  `tunnel.listenPort`; change both together.
- The stack reads `pulumi.getStack()`, not `stack` from `packages/shared`:
  that module needs an AWS region at load.
