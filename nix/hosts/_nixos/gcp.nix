# GCE boot and networking; disko owns filesystems and the bootloader.
{ lib, modulesPath, ... }:
{
  imports = [
    "${modulesPath}/profiles/qemu-guest.nix"
    "${modulesPath}/profiles/headless.nix"
  ];

  boot.kernelParams = [ "console=ttyS0,115200" ];
  boot.initrd.availableKernelModules = [
    "virtio_scsi"
    "virtio_pci"
    "virtio_net"
    "gve"
  ];
  boot.loader.timeout = lib.mkDefault 1;

  # Serial console is the break-glass path when the tailnet is unavailable.
  systemd.services."serial-getty@ttyS0".enable = true;

  networking.usePredictableInterfaceNames = false;
  networking.useDHCP = false;
  networking.interfaces.eth0.mtu = 1460;
  networking.hosts."169.254.169.254" = [
    "metadata.google.internal"
    "metadata"
  ];
  networking.timeServers = [ "metadata.google.internal" ];
}
