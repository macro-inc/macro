# Macro computers hosts

NixOS hosts that run Macro computer VMs. `nix/hosts.nix` exports
`nixosConfigurations.<host>`; the NixOS modules live in `_nixos/` (the
underscore keeps `import-tree` from loading them as flake-parts modules).

| File | Contents |
| --- | --- |
| `_nixos/firecracker-host.nix` | Firecracker host: pinned v1.18.0 firecracker + jailer, storage (`zfs`: `tank/firecracker`, computers as clones of golden snapshots, OpenZFS 2.4.1+ and block-cloning checks, the ARC cap; or `xfs`), kernel hardening (no io_uring, kexec, user namespaces; ptrace 2; no lockdown LSM in nixpkgs' kernel), KSM off, host input nftables scoped to the uplink and tunnel (the agent adds its guest tables), optional WireGuard tunnel, the agent unit (delegated cgroup, `KillMode=process`, TLS as credentials), an mTLS health check, the Datadog agent (OTLP on 127.0.0.1:4317). `_nixos/firecracker-host-test.nix` is its NixOS test (`checks.firecracker-host`; the VM lifecycle needs nested KVM). Provisioning: `docs/guides/firecracker-host-provisioning.md`. |
| `_nixos/gcp.nix` | GCE boot modules, DHCP, MTU, metadata NTP, guest agent, OS Login, root sshd with `keys/admin.pub`, and serial console. |
| `_nixos/keys/admin.pub` | Root's authorized SSH key (over IAP). |


## Configuration formats

Use NixOS structured options for host config (sysctl, networking, systemd).
