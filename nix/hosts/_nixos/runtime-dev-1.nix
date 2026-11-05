# runtime-dev-1: GCE n2-standard-8 in macro-435922/us-east4-b (UEFI, Secure Boot off).
# sda (50 GB) boots; sdb (500 GB) is the ZFS pool for Incus.
{
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
      device = "/dev/disk/by-id/google-persistent-disk-0";
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
      device = "/dev/disk/by-id/google-persistent-disk-1";
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
