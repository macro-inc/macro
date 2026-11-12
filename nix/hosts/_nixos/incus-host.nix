# Incus host for Macro computers: ZFS-backed VMs on an isolated bridge.
# Boxes get outbound internet only; the host and internal ranges are closed
# to them except DNS/DHCP and the control plane.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  computers = config.macro.computers;
  tailnetEnabled = computers.controlPlaneAddress != null;
  ports = lib.concatMapStringsSep ", " toString computers.controlPlanePorts;
  bridge = "boxbr0";
  bridgeAddress = "10.210.0.1";
  controlPlaneCertificate = ./certs/control-plane-dev.crt;
in
{
  options.macro.computers = {
    controlPlaneAddress = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = null;
      description = "Control-plane devbox Tailscale IPv4 address; null disables box tailnet access.";
    };
    controlPlanePorts = lib.mkOption {
      type = lib.types.listOf lib.types.port;
      default = [ ];
      description = "TCP host ports boxes may reach on the control-plane devbox.";
    };
  };

  config = {
    boot.supportedFilesystems = [ "zfs" ];
    boot.zfs.extraPools = [ "tank" ];
    boot.zfs.forceImportRoot = false;
    boot.kernelParams = [ "zfs.zfs_arc_max=8589934592" ];
    boot.kernelModules = [
      "kvm-intel"
      "vhost_vsock"
    ];
    services.zfs.autoScrub.enable = true;

    networking.nftables.enable = true;
    networking.firewall.enable = false;

    virtualisation.incus = {
      enable = true;
      ui.enable = false;
      preseed = {
        # Start locally; incus-tailnet binds the enrolled address, never a WAN wildcard.
        config."core.https_address" = "127.0.0.1:8443";
        networks = [
          {
            name = bridge;
            type = "bridge";
            config = {
              "ipv4.address" = "${bridgeAddress}/24";
              "ipv4.nat" = "true";
              "ipv6.address" = "none";
            };
          }
        ];
        storage_pools = [
          {
            name = "default";
            driver = "zfs";
            config.source = "tank/incus";
          }
        ];
        profiles = [
          {
            name = "default";
            devices = {
              root = {
                path = "/";
                pool = "default";
                type = "disk";
              };
              eth0 = {
                name = "eth0";
                network = bridge;
                type = "nic";
              };
            };
          }
          {
            name = "macro-box";
            description = "Macro computer VM";
            config = {
              "security.secureboot" = "false";
              # /dev/incus inside the guest, so macrod can read user.* keys.
              "security.guestapi" = "true";
            };
            devices = {
              root = {
                path = "/";
                pool = "default";
                type = "disk";
              };
              eth0 = {
                name = "eth0";
                network = bridge;
                type = "nic";
              };
            };
          }
        ];
      };
    };

    systemd.services.incus-trust-control-plane = {
      description = "Trust the Macro control-plane client certificate";
      after = [ "incus-preseed.service" ];
      requires = [ "incus.service" ];
      wantedBy = [ "multi-user.target" ];
      path = [
        config.virtualisation.incus.clientPackage
        pkgs.openssl
      ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
      };
      script = ''
        fingerprint=$(openssl x509 -in ${controlPlaneCertificate} -noout -fingerprint -sha256 \
          | cut -d= -f2 | tr -d : | tr '[:upper:]' '[:lower:]')
        if ! incus query "/1.0/certificates/$fingerprint" >/dev/null 2>&1; then
          incus config trust add-certificate ${controlPlaneCertificate} --name macro-control-plane-dev
        fi
      '';
    };

    # The address is assigned at enrollment, so it cannot be baked into preseed.
    systemd.services.incus-tailnet = lib.mkIf tailnetEnabled {
      description = "Bind Incus to the runtime host's Tailscale IPv4 address";
      after = [
        "incus-preseed.service"
        "tailscaled.service"
        "tailscaled-autoconnect.service"
      ];
      requires = [
        "incus.service"
        "tailscaled.service"
      ];
      wantedBy = [ "multi-user.target" ];
      partOf = [
        "incus.service"
        "incus-preseed.service"
      ];
      restartTriggers = [
        ((pkgs.formats.yaml { }).generate "incus-preseed.yaml" config.virtualisation.incus.preseed)
      ];
      path = [
        config.virtualisation.incus.clientPackage
        config.services.tailscale.package
      ];
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        Restart = "on-failure";
        RestartSec = 5;
      };
      script = ''
        address=$(tailscale ip -4)
        test -n "$address"
        incus config set core.https_address "$address:8443"
      '';
    };

    networking.nftables.tables.macro-boxes = {
      family = "inet";
      content = ''
        set blocked_ipv4 {
          type ipv4_addr
          flags interval
          elements = {
            169.254.0.0/16,
            10.0.0.0/8,
            172.16.0.0/12,
            192.168.0.0/16,
            100.64.0.0/10
          }
        }

        chain input {
          type filter hook input priority filter; policy accept;
          tcp dport 8443 iifname != "lo" iifname != "tailscale0" counter drop
          iifname "tailscale0" jump tailnet_to_host
          iifname "${bridge}" jump box_to_host
          iifname "eth0" jump wan_to_host
        }

        chain tailnet_to_host {
          ct state established,related accept
          ip protocol icmp accept
          tcp dport { 22, 8443 } accept
          counter drop
        }

        chain box_to_host {
          meta nfproto ipv6 counter drop
          ip daddr 100.64.0.0/10 counter drop
          ct state established,related accept
          ip protocol icmp accept
          udp dport { 53, 67 } accept
          tcp dport 53 accept
          counter drop
        }

        # No SSH or Incus API on the GCE NIC.
        chain wan_to_host {
          ct state established,related accept
          ip protocol icmp accept
          udp dport ${toString config.services.tailscale.port} accept
          counter drop
        }

        chain forward {
          type filter hook forward priority filter; policy accept;
          iifname "${bridge}" jump box_out
          oifname "${bridge}" ct state established,related accept
          oifname "${bridge}" counter drop
        }

        chain box_out {
          ${lib.optionalString (tailnetEnabled && computers.controlPlanePorts != [ ]) ''
            oifname "tailscale0" ip daddr ${computers.controlPlaneAddress} tcp dport { ${ports} } accept
          ''}
          oifname "tailscale0" counter drop
          meta nfproto ipv6 counter drop
          ip daddr @blocked_ipv4 counter drop
          tcp dport 25 counter drop
          accept
        }
      '';
    };

    networking.nftables.tables.macro-boxes-nat =
      lib.mkIf (tailnetEnabled && computers.controlPlanePorts != [ ])
        {
          family = "ip";
          content = ''
            chain postrouting {
              type nat hook postrouting priority srcnat; policy accept;
              iifname "${bridge}" oifname "tailscale0" ip saddr 10.210.0.0/24 ip daddr ${computers.controlPlaneAddress} tcp dport { ${ports} } masquerade
            }
          '';
        };

    environment.systemPackages = [
      pkgs.nftables
      pkgs.jq
    ];
  };
}
