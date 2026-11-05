# runtime-dev-1: GCE n2-standard-8 in macro-435922/us-east4-b (UEFI, Secure Boot off).
# sda (50 GB) boots; sdb (500 GB) is the ZFS pool for Incus.
{ lib, ... }:
{
  # Login is interactive after deployment; never store a Tailscale auth key.
  services.tailscale.enable = true;
  services.tailscale.openFirewall = false;
  macro.computers = {
    controlPlaneAddress = "100.116.73.13";
    # Default stack plus the four service offsets in each named port window.
    # Custom --port-base values need an explicit addition here.
    controlPlanePorts = [
      8080
      8086
      8101
      8102
    ]
    ++ lib.concatMap (
      bucket:
      map (offset: 20000 + bucket * 100 + offset) [
        11
        15
        26
        27
      ]
    ) (lib.range 0 119);
  };

  networking.hostName = "runtime-dev-1";
  networking.hostId = "b33dcc70";

  boot.loader.grub = {
    enable = true;
    efiSupport = true;
    efiInstallAsRemovable = true;
  };

  disko.devices = {
    disk.boot = {
      type = "disk";
      device = "/dev/disk/by-id/scsi-0Google_PersistentDisk_persistent-disk-0";
      content = {
        type = "gpt";
        partitions = {
          bios = {
            size = "1M";
            type = "EF02";
          };
          esp = {
            size = "512M";
            type = "EF00";
            content = {
              type = "filesystem";
              format = "vfat";
              mountpoint = "/boot";
              mountOptions = [ "umask=0077" ];
            };
          };
          root = {
            size = "100%";
            content = {
              type = "filesystem";
              format = "ext4";
              mountpoint = "/";
            };
          };
        };
      };
    };
    disk.pool = {
      type = "disk";
      device = "/dev/disk/by-id/scsi-0Google_PersistentDisk_persistent-disk-1";
      content = {
        type = "zfs";
        pool = "tank";
      };
    };
    zpool.tank = {
      type = "zpool";
      options.ashift = "12";
      rootFsOptions = {
        compression = "lz4";
        atime = "off";
        mountpoint = "none";
      };
      # Incus owns everything under tank/incus.
      datasets.incus = {
        type = "zfs_fs";
        options.mountpoint = "none";
      };
    };
  };

  system.stateVersion = "26.05";
}
