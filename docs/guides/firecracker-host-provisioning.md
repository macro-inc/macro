# Provisioning a Firecracker host

A Firecracker host runs `services/firecracker_host` and the computers it
restores. Its software is one NixOS module,
[`nix/hosts/_nixos/firecracker-host.nix`](../../nix/hosts/_nixos/firecracker-host.nix);
its GCP resources are the [`firecracker-host`](../../infra/stacks/firecracker-host/AGENTS.md)
Pulumi stack. Creating, deploying or reinstalling a host needs explicit approval
each time ([Rules](../../CLAUDE.md)).

## What every host needs

- **KVM**: bare metal, or a VM shape with nested virtualization.
- **zram as the only swap**: the module turns on `zramSwap` (zstd, `zramPercent`
  of RAM, 25 % by default) for the memory squeeze and asserts `swapDevices` is
  empty; any other swap (or zram with a writeback device) fails the agent's
  swap check and makes it forbid VMs swap altogether, so the host image must
  not bring its own swap file or partition.
- **One durable disk** holding the ZFS pool `tank`. Everything lives under
  `tank/firecracker` (lz4, ARC capped at 8 GiB): each golden is a dataset
  (`rootfs.ext4`, `mem`, `vmstate` and an empty `/home` of every sold size),
  snapshotted once built and again when a size is added; each computer is a
  `zfs clone` of the latest snapshot, so a move or backup sends only its own
  blocks (`zfs send -i`).
  The module creates `tank/firecracker`, requires OpenZFS 2.4.1 or later with
  matching userland and kernel module, and refuses to start the agent unless
  `feature@block_cloning` is on and `zfs_bclone_enabled` and
  `zfs_bclone_wait_dirty` are 1; the agent checks the same and the module
  version itself (hibernation and golden builds still move files with block
  cloning; creates are dataset clones). The pool itself is the host's disko
  layout.
- **A path from the control plane to the agent port (8444)**, with mTLS pinned
  both ways. Production: a WireGuard tunnel, the module's `tunnel` option, so
  the agent listens only on the tunnel address. Dev only: the NIC address with
  `apiSources` and a cloud firewall rule.
- **Secrets outside the Nix store**, root 0600, copied with `--extra-files` at
  install: `/var/lib/macro/wg.key` (WireGuard),
  `/var/lib/macro/datadog-api-key` and, with `alloy.enable`,
  `/var/lib/macro/metrics-remote-write-password` (Alloy does not start
  without it). The agent's TLS keys are made on the host
  at first boot and reach the agent as systemd credentials.

## The host's NixOS configuration

A host file next to the module sets what is particular to it, and is added to
`nix/hosts.nix` as `flake.nixosConfigurations.<host>`:

```nix
{
  imports = [ ./gcp.nix ./firecracker-host.nix ];      # gcp.nix on GCP only
  networking.hostName = "firecracker-dev-1";            # = the fleet's host name
  networking.hostId = "<8 hex digits>";                  # ZFS
  disko.devices = { /* boot disk; zpool tank on /dev/disk/by-id/google-durable */ };
  macro.firecrackerHost = {
    package = <flake>.packages.x86_64-linux.firecracker-host;
    listenAddress = "10.99.0.3";
    apiSources = [ "10.99.0.1" ];
    tunnel = {
      address = "10.99.0.3/24";
      privateKeyFile = "/var/lib/macro/wg.key";
      peer = { publicKey = "<gateway>"; address = "10.99.0.1"; endpointSources = [ "<gateway public IP>" ]; };
    };
    clientCertificates = [ ./certs/control-plane-<env>.crt ];
    datadog.apiKeyFile = "/var/lib/macro/datadog-api-key";
    # Host and per-computer metrics for the Grafana fleet dashboard.
    alloy = { enable = true; passwordFile = "/var/lib/macro/metrics-remote-write-password"; };
    # ROOT_DISK_GIB in crates/hosted_runtimes/src/domain/image.rs.
    storage.goldenRootDiskGib = 32;
    environment = "production";
  };
}
```

`goldenRootDiskGib` duplicates the control plane's root disk size: change it
on every host in the same change as `ROOT_DISK_GIB`. The `/home` sizes are
not host config: the control plane sends them in `PUT /v1/host/limits`.

`networking.hostName` is the name the agent registers with and the Datadog
host name; keep it equal to the fleet's host row so host metrics and spans join.

## GCP

1. Copy `infra/stacks/firecracker-host/Pulumi.dev.yaml` for the host: shape
   (`hostKind = nested` on N2/C3, `metal` on a `-metal` shape), the durable
   disk (`pd-ssd` on N2; `hyperdisk-balanced` with provisioned IOPS and
   throughput on C3/N4/Z3), and the gateway's address in
   `tunnelGatewaySources`. `pulumi preview`, then, with approval, `pulumi up`.
   The instance boots an Ubuntu installer image.
2. Install NixOS over IAP with
   [nixos-anywhere](https://github.com/nix-community/nixos-anywhere), which
   runs disko (destructive: the durable disk's pool is created here, so never
   rerun it on a host that holds computers):

   ```sh
   extra=$(mktemp -d)
   install -Dm0600 <wg private key file> "$extra/var/lib/macro/wg.key"
   install -Dm0600 <datadog key file> "$extra/var/lib/macro/datadog-api-key"
   install -Dm0600 <metrics password file> "$extra/var/lib/macro/metrics-remote-write-password"
   chmod 0700 "$extra/var/lib/macro"
   nixos-anywhere --flake .#<host> --extra-files "$extra" \
     --ssh-option "ProxyCommand=gcloud compute start-iap-tunnel <host> 22 --listen-on-stdin --zone <zone>" \
     root@<host>
   ```
3. Read the agent's certificate (`/var/lib/firecracker-host-tls/server.crt`)
   and register the host with the fleet; add the host as a peer on the
   gateway.
4. Later changes: `nixos-rebuild switch --flake .#<host> --target-host root@<host>`
   over IAP. The host never builds (`max-jobs = 0`, no user namespaces for a
   sandbox): closures are built on the deploying machine and copied.

The service account can write logs and metrics only (finding S-11): a host
escape gains no GCS or Compute access. Replacing a lost host: create a new
instance in the same zone, attach the durable disk, install with a disko
layout that does not format it, import `tank`, start the agent; hibernated
computers wake from their files and running ones cold boot.

## Hetzner (dedicated, EU)

Dedicated servers (for example the AX line in FSN1, NBG1 or HEL1) are bare
metal, so KVM needs no nesting. What differs from GCP:

- **No Pulumi stack.** Order the server in Robot; there is no instance,
  service account or VPC to create. Use Robot's API or the console, and
  record the server in the resources ledger.
- **No service account or metadata server.** S-11 does not apply; the host
  holds no cloud credentials at all. Logs and metrics leave only through the
  Datadog agent and, when enabled, Alloy's remote write.
- **No cloud firewall.** The module's nftables input chain is the only wall:
  keep `apiSources` to the tunnel peer, set `sshSources` to the administration
  bastion's addresses (the default is GCP's IAP range), and optionally mirror
  them in Robot's stateless firewall as a second wall.
- **The tunnel is mandatory.** The control plane is in AWS; the agent must
  listen only on the WireGuard address (`tunnel` set, `listenAddress` = its
  address). The gateway initiates to the host's public IP on UDP 51820, so
  `endpointSources` is the gateway's Elastic IP. Computer moves between hosts
  (zfs send/receive) also run over WireGuard.
- **Disks are local and durable.** Two NVMe drives become one mirrored pool
  (`zpool create tank mirror ...` in disko) instead of one network disk; there
  is no zone-level disk re-attach, so recovery is a restore from the
  per-computer `zfs send` backups on another host.
- **Install from the rescue system.** Boot Hetzner's Linux rescue, then
  `nixos-anywhere --flake .#<host> --extra-files "$extra" root@<server IP>`.
  Set the uplink (`uplink = "enp…"`) and the static IPv4 and gateway from
  Robot in the host file; drop `gcp.nix`.
- **Egress is included.** GCP charges per GiB of internet egress; a
  dedicated server's traffic is part of its price.
