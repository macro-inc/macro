# The guest as an Incus VM image: nixpkgs' Incus VM module builds the EFI
# qcow2 (systemd-boot, root grown to the disk at boot) and the metadata
# tarball, and runs incus-agent.
{ lib, modulesPath, ... }:
{
  imports = [
    "${modulesPath}/virtualisation/incus-virtual-machine.nix"
    ./_guest.nix
  ];

  # The Incus module's defaults are for interactive images: empty root
  # password, sshd, a copy of nixpkgs and documentation.
  users.users.root.initialHashedPassword = lib.mkForce "!";
  services.openssh.enable = false;
  system.installer.channel.enable = false;
  installer.cloneConfig = false;
  documentation.enable = lib.mkForce false;

  # incus-agent mounts its 9p shares as it starts. Started early by
  # multi-user.target (DefaultDependencies=no), its first attempt can run
  # before the virtio devices are up, fail, and restart only after its 5 s
  # RestartSec. Wait for the agent's virtio port instead; udev already starts
  # it when that device appears.
  systemd.services.incus-agent = {
    wants = [ "dev-virtio\\x2dports-org.linuxcontainers.incus.device" ];
    after = [ "dev-virtio\\x2dports-org.linuxcontainers.incus.device" ];
  };

  boot.loader.timeout = 0;
  # `quiet` keeps kernel messages off the slow serial console, which remains
  # the recovery console.
  boot.kernelParams = [ "quiet" ];
}
