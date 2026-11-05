# Macro computers hosts

NixOS Incus hosts that run Macro computer VMs. `nix/hosts.nix` exports
`nixosConfigurations.<host>`; the NixOS modules live in `_nixos/` (the
underscore keeps `import-tree` from loading them as flake-parts modules).

| File | Contents |
| --- | --- |
| `_nixos/incus-host.nix` | Incus (preseed: ZFS pool `default` on `tank/incus`, bridge `boxbr0` 10.210.0.1/24, profile `macro-box`), control-plane cert trust, box filter/NAT nftables, fallback sshd reverse-tunnel settings, `zfs_arc_max` 8 GiB. |
| `_nixos/gcp.nix` | GCE guest: guest agent, OS Login, metadata, serial console, admin root key `keys/admin.pub`. |
| `_nixos/runtime-dev-1.nix` | Tailscale, control-plane address/ports, hostname, `hostId`, GRUB (UEFI removable + BIOS), disko for `sda` (boot) and `sdb` (zpool `tank`). |
| `_nixos/certs/control-plane-dev.crt` | Public client cert the dev control plane uses for the Incus API. |
| `computers-tunnels.sh` | Fallback supervised SSH-over-IAP tunnels. |

## Hosts

| Host | GCP | Notes |
| --- | --- | --- |
| `runtime-dev-1` | `macro-435922`, `us-east4-b`, n2-standard-8, 10.200.0.2 | Dev. Deploys approved. |

`runtime-prod-1` is not managed here; do not touch it.

## Access

The control plane uses Tailscale with a pinned Incus server certificate and
a trusted client certificate. IAP SSH remains the break-glass/admin path:

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

## Tailscale enrollment

After the first rebuild, use IAP SSH to run this interactively on the runtime:

```sh
sudo tailscale up --hostname=runtime-dev-1 --accept-routes=false --netfilter-mode=off
```

Print the login URL and have the tailnet owner approve it in the same personal
tailnet as the devbox. No auth key belongs in Nix, git, or shell history.
The node uses hostname `runtime-dev-1`; no ACL tag is required in this personal
tailnet. The runtime's nftables owns filtering and masquerading, so leave
Tailscale's netfilter mode off. Do not advertise the box subnet or accept routes.
The login persists in `/var/lib/tailscale` across rebuilds.

On the devbox, `tailscale ip -4 runtime-dev-1` must return exactly one IPv4
address. xtask resolves this at stack start and emits
`COMPUTERS_INCUS_URL=https://<runtime-tailnet-ip>:8443`, avoiding MagicDNS inside
Compose. Override host-side discovery with `COMPUTERS_INCUS_ADDRESS=<IPv4>`.
`COMPUTERS_CONTROL_PLANE_ADDRESS` defaults to `100.116.73.13` and must match the
runtime's `macro.computers.controlPlaneAddress` option. These are xtask inputs,
not service/Doppler secrets.

Incus listens on IPv4 `0.0.0.0:8443` (including loopback for recovery); nftables
admits that port only from `tailscale0` and `lo`. The client pins certificate
bytes, so the tailnet IP/name need not be in the certificate's SANs. The
existing SHA-256 pin is checked before caching a newly fetched certificate.

## Devbox firewall and verification

The devbox must admit the runtime's tailnet IP to the stack's six TCP host
ports: agent egress, harness, document storage, auth, agent git, and the computer
gateway. Read them from the instance's `portmap.json`; do not expose the entire
named-instance port window.
On this devbox, both `ts-input` and `nixos-fw` already accept `-i tailscale0`,
and `DOCKER-USER` has no restrictive rules, so no extra rule is needed.
Verify without restarting anything:

```sh
sudo -n iptables -L INPUT -n --line-numbers
sudo -n iptables -S ts-input
sudo -n iptables -S nixos-fw
sudo -n iptables -S DOCKER-USER
```

On a devbox with a restrictive INPUT policy, insert this rule before its reject
(use the runtime IP and the instance's six host ports):

```sh
sudo -n iptables -I INPUT 1 -i tailscale0 -s <runtime-tailnet-ip>/32 -d 100.116.73.13 -p tcp -m multiport --dports <egress>,<harness>,<storage>,<auth>,<agent-git>,<computer-gateway> -j ACCEPT
```

For Docker-published ports, also allow forwarding in `DOCKER-USER` if that chain
rejects traffic. Match the original published destination because DNAT has
already run (repeat for the six host ports):

```sh
sudo -n iptables -I DOCKER-USER 1 -i tailscale0 -s <runtime-tailnet-ip>/32 -p tcp -m conntrack --ctorigdst 100.116.73.13 --ctorigdstport <host-port> -j ACCEPT
```

Persist equivalent rules in the devbox's host configuration when needed.
From the runtime, check `curl -v http://100.116.73.13:<harness>/health`.
From the devbox, test Incus with the client identity and pinned certificate
using the control plane; a TLS SAN mismatch in ordinary curl is expected.

## IAP tunnel fallback

Keep IAP SSH available even after enrollment. Run these on the devbox only
when diagnosing/recovering the tailnet path; `GCLOUD` can name a binary outside
PATH. They are no longer required or started by xtask's Incus mode.

```sh
nix/hosts/computers-tunnels.sh incus               # https://localhost:18443 -> Incus API
nix/hosts/computers-tunnels.sh reverse 4000 4001   # boxes -> 10.210.0.1:<port> -> devbox localhost:<port>
nix/hosts/computers-tunnels.sh all 4000 4001       # both
```

Reverse ports come from the local stack's
`infra/local/generated/<instance>/portmap.json`. The supervisor refreshes
`@tunnel_ports`; entries expire 90 s after it stops. This is a manual transport
fallback: an existing tailnet-configured stack does not automatically switch to
it. For a manual recovery client, use `https://localhost:18443` and override box
service URLs to `http://10.210.0.1:<host port>`; Compose containers need their own
explicit route/relay to that host-local endpoint.

Check the fallback tunnel (diagnostic only; the control plane still pins TLS):

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
(NAT). The only forwarded tailnet access is TCP to
`macro.computers.controlPlaneAddress` on `macro.computers.controlPlanePorts`,
masqueraded to the runtime's `tailscale0` address. All other traffic exiting
`tailscale0` is dropped, as are the rest of 100.64.0.0/10, private ranges,
metadata, tcp/25 and IPv6. The default port list covers the default stack and
only the six service offsets (11, 15, 26, 27, 33, 34) in each standard named-instance
window (20000–31999). The fixed default-stack ports are 8080, 8086, 8101, 8102,
8111 (agent git), and 8112 (computer gateway); custom `--port-base` values need
an explicit option update.
Replies are stateful; unsolicited inbound to boxes is dropped. Boxes cannot
reach the host except DNS/DHCP and fallback `@tunnel_ports` on 10.210.0.1.
Box-to-box traffic on the bridge is layer 2 and not filtered.

Stateful stop of a VM needs room for its memory on the root volume: set
`size.state` on the instance's root disk (at least the VM's RAM).
