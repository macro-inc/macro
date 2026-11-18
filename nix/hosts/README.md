# Macro computers hosts

NixOS hosts that run Macro computer VMs. `nix/hosts.nix` exports
`nixosConfigurations.<host>`; the NixOS modules live in `_nixos/` (the
underscore keeps `import-tree` from loading them as flake-parts modules).

| File | Contents |
| --- | --- |
| `_nixos/gcp.nix` | GCE boot modules, DHCP, MTU, metadata NTP, guest agent, OS Login, root sshd with `keys/admin.pub`, and serial console. |
| `_nixos/keys/admin.pub` | Root's authorized SSH key (over IAP). |

No host is defined here yet. `runtime-prod-1` is not managed here; do not
touch it.

## Configuration formats

Use NixOS structured options for host config (sysctl, networking, systemd).
