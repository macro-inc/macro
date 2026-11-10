# Macro computers hosts

NixOS Incus hosts that run Macro computer VMs. `nix/hosts.nix` exports
`nixosConfigurations.<host>`; the NixOS modules live in `_nixos/` (the
underscore keeps `import-tree` from loading them as flake-parts modules).

| File | Contents |
| --- | --- |
| `_nixos/incus-host.nix` | Incus (preseed: ZFS pool `default` on `tank/incus`, bridge `boxbr0` 10.210.0.1/24, profile `macro-box`), control-plane cert trust, box filter/NAT nftables, `zfs_arc_max` 8 GiB. |
| `_nixos/gcp.nix` | GCE boot modules, MTU, metadata NTP, and serial console. |
| `_nixos/runtime-dev-1.nix` | Tailscale, control-plane address/ports, hostname, `hostId`, GRUB (UEFI removable + BIOS), disko for `sda` (boot) and `sdb` (zpool `tank`). |
| `_nixos/certs/control-plane-dev.crt` | Public client cert the dev control plane uses for the Incus API. |

## Hosts

| Host | GCP | Notes |
| --- | --- | --- |
| `runtime-dev-1` | `macro-435922`, `us-east4-b`, n2-standard-8, 10.200.0.2 | Dev. Deploys approved. |

`runtime-prod-1` is not managed here; do not touch it.

## Access

The demo uses a personal tailnet; production must use the company tailnet.
The control plane uses Tailscale with a pinned Incus server certificate and a
trusted client certificate. Administration uses Tailscale SSH (`--ssh`) at
`root@runtime-dev-1` through MagicDNS; no plain sshd or OS Login remains.
Allow the administrator to SSH as root to `tag:runtime-host` in the tailnet SSH
policy, and allow the control plane to reach that tag on TCP/8443. Use a
pre-authorized auth key carrying `tag:runtime-host`. Do not advertise the box
subnet or accept routes.

Serial console is the break-glass path (serial-getty remains enabled; provision
recovery credentials separately):

```sh
gcloud compute connect-to-serial-port runtime-dev-1 --project macro-435922 --zone us-east4-b
```

## Deploy: last IAP use

Run from the checkout on the coordinator. This switches the existing host; it
never runs disko or wipes disks. Copy the key before switching, while the old
IAP/root-key access is still available. The option
`macro.runtimeHost.tailscaleAuthKeyFile` defaults to null; this host passes
`/var/lib/macro/tskey`. It is a string path, never a Nix path or key contents.
The key stays root-only outside the Nix store, repository, and deploy command line.

Use bash for the deploy commands (the SSH option array preserves quoting):

```bash
iap=( -o 'ProxyCommand=gcloud compute start-iap-tunnel runtime-dev-1 22 --listen-on-stdin --project macro-435922 --zone us-east4-b'
      -o HostKeyAlias=runtime-dev-1
      -o "UserKnownHostsFile=$HOME/.config/macro-computers/known_hosts" )
ssh "${iap[@]}" root@runtime-dev-1 'install -d -m 0700 /var/lib/macro; umask 077; cat > /var/lib/macro/tskey; chmod 0600 /var/lib/macro/tskey' < ~/.config/macro/runtime-host-tskey
export NIX_SSHOPTS="-o ProxyCommand='gcloud compute start-iap-tunnel runtime-dev-1 22 --listen-on-stdin --project macro-435922 --zone us-east4-b' -o HostKeyAlias=runtime-dev-1 -o UserKnownHostsFile=$HOME/.config/macro-computers/known_hosts"
nixos-rebuild switch --flake .#runtime-dev-1 --target-host root@runtime-dev-1
unset NIX_SSHOPTS
ssh root@runtime-dev-1 'tailscale status; incus config get core.https_address'
```

The switching IAP session may close when sshd stops. Verify the new generation
via Tailscale SSH before treating the switch as complete. Activation starts
`tailscaled-autoconnect`, reading the root-only key file at runtime; state
persists under `/var/lib/tailscale`. Tailscale owns its packet filtering;
`macro-boxes` still restricts forwarded box traffic independently.

Fresh installation is destructive and needs separate approval. For
`nixos-anywhere`, prepare a temporary extra-files tree with
`install -Dm0600 ~/.config/macro/runtime-host-tskey "$extra/var/lib/macro/tskey"`
and `chmod 0700 "$extra/var/lib/macro"`, then pass `--extra-files "$extra"`.
Never copy the key into the checkout or use `builtins.readFile` for it.

## Subsequent deploys

MagicDNS resolves `runtime-dev-1` on the tailnet; no IAP proxy is used:

```sh
unset NIX_SSHOPTS
nixos-rebuild switch --flake .#runtime-dev-1 --target-host root@runtime-dev-1
```

On the devbox, `tailscale ip -4 runtime-dev-1` must return exactly one IPv4
address. xtask resolves this at stack start and emits
`COMPUTERS_INCUS_URL=https://<runtime-tailnet-ip>:8443`, avoiding MagicDNS inside
Compose. Override host-side discovery with `COMPUTERS_INCUS_ADDRESS=<IPv4>`.
xtask resolves the devbox address once with `tailscale ip -4` and fails startup
if it does not return one tailnet IPv4 address. Guests dial service HTTP and
WebSocket host ports directly at that address; it must match the runtime's
`macro.computers.controlPlaneAddress` (`100.116.73.13` in this configuration).
`COMPUTERS_INCUS_ADDRESS` is an xtask input, not a service/Doppler secret.

Incus starts on `127.0.0.1:8443`; `incus-tailnet.service` binds it exclusively
to the enrolled tailnet IPv4 address. Local tooling uses the Unix socket.
Nftables admits TCP/8443 only from `tailscale0` and `lo`. The client pins certificate
bytes, so the tailnet IP/name need not be in the certificate's SANs. The
existing SHA-256 pin is checked before caching a newly fetched certificate.

## Devbox firewall and verification

The devbox must admit the runtime's tailnet IP to the stack's seven TCP host
ports: agent egress, harness, document storage, auth, agent git, and the computer
gateway, plus the connection gateway websocket. Read them from the instance's
`portmap.json`; do not expose the entire named-instance port window.
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
(use the runtime IP and the instance's seven host ports):

```sh
sudo -n iptables -I INPUT 1 -i tailscale0 -s <runtime-tailnet-ip>/32 -d 100.116.73.13 -p tcp -m multiport --dports <egress>,<harness>,<storage>,<auth>,<agent-git>,<computer-gateway>,<connection-gateway-websocket> -j ACCEPT
```

For Docker-published ports, also allow forwarding in `DOCKER-USER` if that chain
rejects traffic. Match the original published destination because DNAT has
already run (repeat for the seven host ports):

```sh
sudo -n iptables -I DOCKER-USER 1 -i tailscale0 -s <runtime-tailnet-ip>/32 -p tcp -m conntrack --ctorigdst 100.116.73.13 --ctorigdstport <host-port> -j ACCEPT
```

Persist equivalent rules in the devbox's host configuration when needed.
From the runtime, check `curl -v http://100.116.73.13:<harness>/health`.
From the devbox, test Incus with the client identity and pinned certificate
using the control plane; a TLS SAN mismatch in ordinary curl is expected.

## Control-plane client cert

- Private key and cert: `~/.config/macro-computers/dev-client.{key,crt}` on the devbox (never in git).
- Public cert in the repo: `_nixos/certs/control-plane-dev.crt`; `incus-trust-control-plane.service` adds it to the Incus trust store at boot.
- Rotate: generate a new pair, replace the repo cert, rebuild, then remove the old one with `incus config trust remove <fingerprint>`.

## Configuration formats

Use NixOS structured options for host config (including Incus preseed, sysctl,
networking, and systemd). The `macro-boxes` filter and `macro-boxes-nat` rules
remain nftables text because nixpkgs has no nftables ruleset format generator.

## Box network policy

Boxes on `boxbr0` get DHCP/DNS from the bridge and outbound IPv4 internet
(NAT). The only forwarded tailnet access is TCP to
`macro.computers.controlPlaneAddress` on `macro.computers.controlPlanePorts`,
masqueraded to the runtime's `tailscale0` address. All other traffic exiting
`tailscale0` is dropped, as are the rest of 100.64.0.0/10, private ranges,
metadata, tcp/25 and IPv6. The default port list covers the default stack and
only the seven service offsets (11, 12, 15, 26, 27, 33, 34) in each standard
named-instance window (20000–31999). The fixed default-stack ports are 8080,
8082 (connection gateway websocket), 8086, 8101, 8102, 8111 (agent git), and
8112 (computer gateway); custom `--port-base` values need an explicit option
update. A NixOS assertion checks that 8082 and offset 12 in every named window
remain allowed.
Replies are stateful; unsolicited inbound to boxes is dropped. Boxes cannot
reach the host except DNS/DHCP on 10.210.0.1.
Box-to-box traffic on the bridge is layer 2 and not filtered.
