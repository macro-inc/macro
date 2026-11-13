# runtime-dev-1: GCE n2-standard-8 in macro-435922/us-east4-b (UEFI, Secure Boot off).
# sda (50 GB) boots; sdb (500 GB) is the ZFS pool for Incus.
{ config, lib, ... }:
{
  config = {
    assertions = [
      {
        assertion = builtins.all (port: builtins.elem port config.macro.computers.controlPlanePorts) (
          [ 8082 ] ++ map (bucket: 20000 + bucket * 100 + 12) (lib.range 0 119)
        );
        message = "Computers must reach the connection gateway websocket on the default stack and every named port window.";
      }
    ];
    macro.computers = {
      # The dev control plane (AWS) reaches Incus through its WireGuard gateway,
      # which routes 10.200.0.0/24 into the tunnel.
      apiAddress = "10.200.0.2";
      tunnel = {
        address = "10.99.0.2/24";
        privateKeyFile = "/var/lib/macro/wg.key";
        peer = {
          publicKey = "2t7yXkA/POqPR8+qpb4mIUCKVfnKIQmMPQNW9q5IGHQ=";
          address = "10.99.0.1";
        };
      };
      # Box access to a devbox stack over Tailscale. This host runs no
      # Tailscale, so these rules match nothing until it rejoins a tailnet.
      controlPlaneAddress = "100.116.73.13";
      # Default stack plus seven service offsets, including the connection
      # gateway websocket, agent git, and computer gateway, in each named window.
      # Custom --port-base values need an explicit addition here.
      controlPlanePorts = [
        8080
        8082
        8086
        8101
        8102
        8111
        8112
      ]
      ++ lib.concatMap (
        bucket:
        map (offset: 20000 + bucket * 100 + offset) [
          11
          12
          15
          26
          27
          33
          34
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
  };
}
