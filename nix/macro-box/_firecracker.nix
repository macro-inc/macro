# The guest as a Firecracker microVM: an uncompressed vmlinux booted directly
# with no initrd, an ext4 root on the first drive and /home on the second.
# The host boots it once, unenrolled, and snapshots it; every computer is a
# restore of that snapshot. The golden boot never mounts /home: the host
# swaps the customer's volume in for the placeholder drive at restore, and
# `macro-restore` (on the VMGenID change, and at every boot) takes the
# computer's identity from MMDS, mounts /home and starts what needs it.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box;
  # Firecracker's CI microVM config plus what macro-box needs (Docker, the
  # nix sandbox, envfs, the firewall), everything built in: no initrd and no
  # modules. kernel/update.sh regenerates it.
  kernel = pkgs.linuxManualConfig {
    inherit (pkgs.linuxPackages.kernel) version src;
    configfile = ./kernel/firecracker-x86_64.config;
  };
in
{
  imports = [
    ./_guest.nix
    ./_firecracker-restore.nix
  ];

  options.macro.box.firecracker.guestAgent = lib.mkOption {
    type = lib.types.package;
    description = "firecracker-guest-agent: runs the host's programs over vsock port 1024.";
  };

  options.macro.box.firecracker.serialConsole = lib.mkOption {
    type = lib.types.bool;
    default = false;
    description = ''
      A console on ttyS0, for debugging an image by hand. Off in computers: a
      guest could flood the host's log through it.
    '';
  };

  options.macro.box.firecracker.kernelParams = lib.mkOption {
    type = lib.types.listOf lib.types.str;
    readOnly = true;
    description = "The `boot_args` Firecracker boots this system with.";
  };

  config = {
    boot.kernelPackages = pkgs.linuxPackagesFor kernel;
    boot.initrd.enable = false;
    boot.loader.grub.enable = false;
    boot.kernelParams = [
      (if cfg.firecracker.serialConsole then "console=ttyS0" else "8250.nr_uarts=0")
      # The host restores with `clock_realtime`, which moves kvm-clock only.
      "clocksource=kvm-clock"
      "quiet"
      "udev.log_level=3"
      "reboot=k"
      "panic=1"
      "pci=off"
      "net.ifnames=0"
    ];
    # Firecracker adds `root=/dev/vda` and the virtio-mmio devices.
    macro.box.firecracker.kernelParams = config.boot.kernelParams ++ [
      "init=${config.system.build.toplevel}/init"
    ];

    # Up in the golden boot too: the host waits for readiness through it.
    systemd.services.firecracker-guest-agent = {
      description = "Run the Firecracker host's programs over vsock";
      wantedBy = [ "multi-user.target" ];
      unitConfig.StartLimitIntervalSec = 0;
      serviceConfig = {
        ExecStart = lib.getExe' cfg.firecracker.guestAgent "firecracker-guest-agent";
        Restart = "always";
        RestartSec = 1;
      };
    };

    fileSystems."/" = {
      device = "/dev/vda";
      fsType = "ext4";
      autoResize = true;
    };

    # As in the Incus image: no root password, no documentation.
    documentation.enable = false;
    users.users.root.initialHashedPassword = "!";
  };
}
