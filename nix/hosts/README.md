# Macro computers hosts

NixOS Incus hosts that run Macro computer VMs. `nix/hosts.nix` exports
`nixosConfigurations.<host>`; the NixOS modules live in `_nixos/` (the
underscore keeps `import-tree` from loading them as flake-parts modules).

| File | Contents |
| --- | --- |
| `_nixos/incus-host.nix` | Incus (preseed: ZFS pool `default` on `tank/incus`, bridge `boxbr0` 10.210.0.1/24, profile `macro-box`), control-plane cert trust, box nftables (table `inet macro-boxes`), sshd reverse-tunnel settings, `zfs_arc_max` 8 GiB. |
| `_nixos/gcp.nix` | GCE guest: guest agent, OS Login, metadata, serial console, admin root key `keys/admin.pub`. |
| `_nixos/runtime-dev-1.nix` | Hostname, `hostId`, GRUB (UEFI removable + BIOS), disko for `sda` (boot) and `sdb` (zpool `tank`). |
| `_nixos/certs/control-plane-dev.crt` | Public client cert the dev control plane uses for the Incus API. |
| `computers-tunnels.sh` | Supervised SSH-over-IAP tunnels from the devbox to the host. |

## Hosts

| Host | GCP | Notes |
| --- | --- | --- |
| `runtime-dev-1` | `macro-435922`, `us-east4-b`, n2-standard-8, 10.200.0.2 | Dev. Deploys approved. |

`runtime-prod-1` is not managed here; do not touch it.

## Access

GCP only admits IAP on tcp/22, so everything rides SSH over IAP:

```sh
gcloud compute ssh runtime-dev-1 --project macro-435922 --zone us-east4-b --tunnel-through-iap   # OS Login user, sudo
ssh -o ProxyCommand='gcloud compute start-iap-tunnel runtime-dev-1 22 --listen-on-stdin --project macro-435922 --zone us-east4-b' root@runtime-dev-1
```

Recovery: `gcloud compute connect-to-serial-port runtime-dev-1 --project macro-435922 --zone us-east4-b`.

## Rebuild

```sh
export NIX_SSHOPTS="-o ProxyCommand='gcloud compute start-iap-tunnel runtime-dev-1 22 --listen-on-stdin --project macro-435922 --zone us-east4-b' -o HostKeyAlias=runtime-dev-1 -o UserKnownHostsFile=$HOME/.config/macro-computers/known_hosts"
nixos-rebuild switch --flake .#runtime-dev-1 --target-host root@runtime-dev-1
```

Fresh install (wipes both disks) from a running Linux with root SSH.
nixos-anywhere splits `--ssh-option` values on spaces, so put the IAP
command in a wrapper script (`iap-proxy.sh` below just `exec`s
`gcloud compute start-iap-tunnel runtime-dev-1 22 --listen-on-stdin ...`):

```sh
nix run github:nix-community/nixos-anywhere -- --flake .#runtime-dev-1 \
  --ssh-option ProxyCommand=$PWD/iap-proxy.sh \
  --ssh-option UserKnownHostsFile=/dev/null --ssh-option StrictHostKeyChecking=no \
  root@runtime-dev-1
```

Disks are addressed as `/dev/disk/by-id/scsi-0Google_PersistentDisk_<device-name>`;
the `google-*` links need GCE udev rules the installer lacks.
`gcp.nix` exempts uid 0 from `pam_oslogin_login`'s account check, which
otherwise denies every non-OS-Login user, including root.

## Tunnels

Run on the devbox; each tunnel restarts when it drops. `GCLOUD` points at the
gcloud binary when it is not on `PATH`.

```sh
nix/hosts/computers-tunnels.sh incus               # https://localhost:18443 -> Incus API
nix/hosts/computers-tunnels.sh reverse 4000 4001   # boxes -> 10.210.0.1:<port> -> devbox localhost:<port>
nix/hosts/computers-tunnels.sh all 4000 4001       # both
systemd-run --user --unit macro-computers-tunnels -p Restart=always nix/hosts/computers-tunnels.sh all 4000 4001
```

The Incus API listens on the host's loopback only (`127.0.0.1:8443`), so the
`incus` tunnel is an SSH `-L` forward rather than an IAP tunnel to 8443.
Reverse ports come from the local stack's `infra/local/generated/<instance>/portmap.json`.
The reverse tunnel keeps the host's `@tunnel_ports` nftables set refreshed;
entries expire 90 s after it stops, closing those ports to boxes.

Check the control-plane tunnel:

```sh
curl -sk --cert ~/.config/macro-computers/dev-client.crt --key ~/.config/macro-computers/dev-client.key \
  https://localhost:18443/1.0 | jq .metadata.auth   # "trusted"
```

## Control-plane client cert

- Private key and cert: `~/.config/macro-computers/dev-client.{key,crt}` on the devbox (never in git).
- Public cert in the repo: `_nixos/certs/control-plane-dev.crt`; `incus-trust-control-plane.service` adds it to the Incus trust store at boot.
- Rotate: generate a new pair, replace the repo cert, rebuild, then remove the old one with `incus config trust remove <fingerprint>`.

## Box network policy

Boxes on `boxbr0` get DHCP/DNS from the bridge and outbound IPv4 internet
(NAT). Dropped: anything to the host except DNS/DHCP and `@tunnel_ports` on
10.210.0.1; 169.254.0.0/16 (metadata), 10.0.0.0/8, 172.16.0.0/12,
192.168.0.0/16, 100.64.0.0/10; tcp/25; IPv6; and all inbound to boxes.
Box-to-box traffic on the bridge is layer 2 and not filtered.

Stateful stop of a VM needs room for its memory on the root volume: set
`size.state` on the instance's root disk (at least the VM's RAM).
