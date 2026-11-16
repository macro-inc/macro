# Incus host for Macro computers: ZFS-backed VMs on an isolated bridge.
# Boxes get outbound internet only; the host and internal ranges are closed
# to them except DNS/DHCP and the control plane. The control plane reaches the
# Incus API over a WireGuard tunnel; nothing else may reach TCP/8443.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  computers = config.macro.computers;
  tailnetEnabled = computers.controlPlaneAddress != null;
  tunnel = computers.tunnel;
  tunnelInterface = "wg0";
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
    apiAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "IPv4 address the Incus API listens on (port 8443); never a wildcard.";
    };
    tunnel = lib.mkOption {
      default = null;
      description = "WireGuard tunnel the control plane uses to reach the Incus API; null keeps it local.";
      type = lib.types.nullOr (
        lib.types.submodule {
          options = {
            address = lib.mkOption {
              type = lib.types.str;
              description = "The host's tunnel address in CIDR form.";
            };
            listenPort = lib.mkOption {
              type = lib.types.port;
              default = 51820;
              description = "UDP port the tunnel listens on, open on eth0.";
            };
            privateKeyFile = lib.mkOption {
              type = lib.types.str;
              description = "Absolute host-local private key path, outside the Nix store; never the key itself.";
            };
            peer = {
              publicKey = lib.mkOption {
                type = lib.types.str;
                description = "The control-plane gateway's public key.";
              };
              address = lib.mkOption {
                type = lib.types.str;
                description = "The gateway's tunnel IPv4 address, the only source admitted to TCP/8443.";
              };
            };
          };
        }
      );
    };
  };

  config = {
    assertions = [
      {
        assertion =
          !(builtins.elem computers.apiAddress [
            "0.0.0.0"
            "::"
            ""
          ]);
        message = "The Incus API address must not be a wildcard.";
      }
    ]
    ++ lib.optionals (tunnel != null) [
      {
        assertion =
          lib.hasPrefix "/" tunnel.privateKeyFile && !(lib.hasPrefix "/nix/store/" tunnel.privateKeyFile);
        message = "The WireGuard private key must be a host-local absolute path outside /nix/store.";
      }
      {
        assertion = computers.apiAddress != "127.0.0.1";
        message = "With a tunnel, the Incus API must listen on an address the tunnel routes to.";
      }
    ];

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
        # Never a wildcard; nftables admits 8443 only from lo and the tunnel peer.
        config."core.https_address" = "${computers.apiAddress}:8443";
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

    # The gateway initiates (no endpoint here) and masquerades the control
    # plane, so the only source seen on the tunnel is the peer address.
    networking.wireguard.interfaces.${tunnelInterface} = lib.mkIf (tunnel != null) {
      ips = [ tunnel.address ];
      inherit (tunnel) listenPort privateKeyFile;
      # eth0's 1460 minus 60 bytes of IPv4 WireGuard overhead.
      mtu = 1400;
      peers = [
        {
          inherit (tunnel.peer) publicKey;
          allowedIPs = [ "${tunnel.peer.address}/32" ];
        }
      ];
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
          iifname "lo" accept
          ${lib.optionalString (tunnel != null) ''iifname "${tunnelInterface}" jump tunnel_to_host''}
          tcp dport 8443 counter drop
          iifname "${bridge}" jump box_to_host
          iifname "eth0" jump wan_to_host
        }

        ${lib.optionalString (tunnel != null) ''
          chain tunnel_to_host {
            ct state established,related accept
            ip protocol icmp accept
            ip saddr ${tunnel.peer.address} tcp dport 8443 accept
            counter drop
          }
        ''}

        chain box_to_host {
          meta nfproto ipv6 counter drop
          ip daddr 100.64.0.0/10 counter drop
          ct state established,related accept
          ip protocol icmp accept
          udp dport { 53, 67 } accept
          tcp dport 53 accept
          counter drop
        }

        # GCP's firewall admits only IAP on tcp/22 (and the gateway on the
        # tunnel port); this is the second wall. No Incus API on the GCE NIC.
        chain wan_to_host {
          ct state established,related accept
          ip protocol icmp accept
          udp dport 68 accept
          ip saddr 35.235.240.0/20 tcp dport 22 accept
          ${lib.optionalString (tunnel != null) "udp dport ${toString tunnel.listenPort} accept"}
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
