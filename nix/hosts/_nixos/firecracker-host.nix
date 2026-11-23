# Firecracker host for Macro computers: the host agent
# (services/firecracker_host) restoring computers from golden snapshots in
# jailed Firecracker microVMs, one netns each.
#
# This module owns the host around the agent: pinned Firecracker + jailer,
# the durable storage (ZFS: each computer a clone of its golden's snapshot;
# or XFS with reflink),
# kernel and sysctl hardening, the host's own input firewall (the agent adds
# its guest tables, prefix `fch`, at start), an optional WireGuard tunnel to
# the control plane, TLS as root-only credentials, the Datadog agent the
# agent's OTLP goes to, Grafana Alloy shipping host and per-computer cgroup
# metrics to Macro's Prometheus, and a health check. Security findings it implements
# are named S-<n> (docs/architecture/firecracker-computers-security.md).
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.firecrackerHost;
  version = "v1.18.0";
  # Release binaries, pinned, root-owned in the store (S-18).
  firecrackerRelease = pkgs.stdenvNoCC.mkDerivation {
    pname = "firecracker-release";
    inherit version;
    src = pkgs.fetchurl {
      url = "https://github.com/firecracker-microvm/firecracker/releases/download/${version}/firecracker-${version}-x86_64.tgz";
      hash = "sha256-GsjuyGbdXuoU7+z2Mj4isj7qJAVFRTOKWzS8W8pmI80=";
    };
    installPhase = ''
      install -Dm0555 firecracker-${version}-x86_64 $out/bin/firecracker
      install -Dm0555 jailer-${version}-x86_64 $out/bin/jailer
    '';
  };
  tlsDirectory = "/var/lib/firecracker-host-tls";
  tunnelInterface = "wg0";
  movesInterface = "wg-moves";
  minimumZfsVersion = "2.4.1";
  zfsKernelModule = config.boot.kernelPackages.${config.boot.zfs.package.kernelModuleAttribute};
  movesAddress = builtins.head (lib.splitString "/" cfg.moves.address);
  movesEndpointSources = map (
    peer: builtins.head (lib.splitString ":" peer.endpoint)
  ) cfg.moves.peers;
  # VM slot n runs as uidBase + n (the golden slot is n = slots): clear of
  # system users, nixbld and subuid ranges (S-20).
  uidBase = 1000000000;
  vmIds = id: id >= uidBase && id <= uidBase + cfg.slots;
  rangeOverlapsVmIds =
    range:
    range.startUid or range.startGid < uidBase + cfg.slots + 1
    && uidBase < (range.startUid or range.startGid) + range.count;
  credentials = "/run/credentials/firecracker-host.service";
  zfsPool = builtins.head (lib.splitString "/" cfg.storage.zfsDataset);
  apiUrl = "https://${cfg.listenAddress}:${toString cfg.port}";
  disks =
    {
      zfs = {
        kind = "zfs";
        dataset = cfg.storage.zfsDataset;
      };
      xfs = {
        kind = "xfs";
        directory = cfg.storage.xfsDirectory;
      };
    }
    .${cfg.storage.kind};
  configFile = (pkgs.formats.toml { }).generate "firecracker-host.toml" (
    {
      host_name = config.networking.hostName;
      listen = "${cfg.listenAddress}:${toString cfg.port}";
      tls = {
        certificate = "${credentials}/tls-certificate";
        key = "${credentials}/tls-key";
        client_certificates = [
          "${credentials}/client-health"
        ]
        ++ lib.imap0 (index: _: "${credentials}/client-${toString index}") cfg.clientCertificates;
      };
      binaries = {
        firecracker = "${firecrackerRelease}/bin/firecracker";
        jailer = "${firecrackerRelease}/bin/jailer";
        firecracker_version = version;
      };
      storage = {
        images_dir = cfg.imagesDir;
        golden_root_disk_gib = cfg.storage.goldenRootDiskGib;
        inherit disks;
      };
      network = {
        slots = cfg.slots;
        prefix = "fch";
        veth_base = "10.201.0.0";
        inherit (cfg) dns uplink;
        api_sources = cfg.apiSources;
        guest_destinations = cfg.guestDestinations;
      }
      // lib.optionalAttrs (cfg.controlPlane != null) {
        control_plane = { inherit (cfg.controlPlane) address ports; };
      };
      jail = {
        uid_base = uidBase;
        memory_overhead_mib = 256;
      };
      guest = {
        shutdown_grace = 30;
        golden_boot_timeout = 600;
        guest_agent_timeout = 30;
        concurrent_launches = 8;
      };
    }
    // lib.optionalAttrs (cfg.moves != null) {
      moves = {
        listen = "${movesAddress}:${toString cfg.moves.port}";
        connect_timeout = cfg.moves.connectTimeout;
      };
    }
  );
  # The health check's endpoint: the host's own client certificate, made
  # with the server's (paths only; the files are root 0400).
  healthEndpoint = pkgs.writeText "firecracker-host-health-endpoint.toml" ''
    url = "${apiUrl}"
    client_certificate = "${tlsDirectory}/health.crt"
    client_key = "${tlsDirectory}/health.key"
    server_certificate = "${tlsDirectory}/server.crt"
  '';
in
{
  options.macro.firecrackerHost = {
    package = lib.mkOption {
      type = lib.types.package;
      description = "The firecracker-host agent (`packages.<system>.firecracker-host`).";
    };
    listenAddress = lib.mkOption {
      type = lib.types.str;
      description = "IPv4 address the agent API listens on (port `port`): the tunnel address with a tunnel, else the NIC address. Never a wildcard.";
    };
    port = lib.mkOption {
      type = lib.types.port;
      # Also the default of infra/stacks/firecracker-host's `agentPort`.
      default = 8444;
      description = "Agent API port.";
    };
    apiSources = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      description = "IPv4 sources admitted to the API port: the tunnel peer, or the control plane's egress addresses without a tunnel.";
    };
    clientCertificates = lib.mkOption {
      type = lib.types.nonEmptyListOf lib.types.path;
      description = "PEM client certificates of control planes; a client must present one byte for byte.";
    };
    storage = {
      kind = lib.mkOption {
        type = lib.types.enum [
          "zfs"
          "xfs"
        ];
        default = "zfs";
        description = ''
          Where computers' disks, goldens and hibernation files live. `zfs`:
          under `zfsDataset`, each golden a dataset (disks) with a `memory`
          child, snapshotted once built; each computer a `zfs clone` of
          those snapshots, so `zfs send -i` moves only its own blocks. Block
          cloning still serves the agent's file copies inside the pool.
          `xfs`: files on one XFS filesystem with reflink at `xfsDirectory`.
        '';
      };
      zfsDataset = lib.mkOption {
        type = lib.types.str;
        default = "tank/firecracker";
        description = "Parent dataset (`<pool>/...`); created at boot if missing. The pool itself is the host's (disko), imported by this module.";
      };
      xfsDirectory = lib.mkOption {
        type = lib.types.str;
        default = "/var/lib/firecracker-host";
        description = "Mount point of the XFS filesystem (reflink) for `kind = \"xfs\"`.";
      };
      goldenRootDiskGib = lib.mkOption {
        type = lib.types.ints.positive;
        example = 32;
        description = "Size a golden's rootfs is grown to before its boot: the root disk computers are sold with (the guest grows its filesystem at boot, not at restore). Must equal ROOT_DISK_GIB in crates/hosted_runtimes/src/domain/image.rs (each tier's root_disk_gib in domain/size.rs).";
      };
      arcMaxBytes = lib.mkOption {
        type = lib.types.ints.positive;
        default = 8 * 1024 * 1024 * 1024;
        description = "ZFS ARC ceiling; count it in the host's reserved memory.";
      };
    };
    imagesDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/firecracker-host-images";
      description = "Installed guest images: `<imagesDir>/<image>/{vmlinux,rootfs.ext4,boot_args}`.";
    };
    slots = lib.mkOption {
      type = lib.types.ints.between 1 16384;
      default = 128;
      description = "Netns slots: the most computers with a process at once.";
    };
    zramPercent = lib.mkOption {
      type = lib.types.ints.between 1 100;
      default = 25;
      description = ''
        Size of the zram swap device, in percent of RAM (uncompressed; zstd
        stores guest pages at roughly a third). The squeeze pushes idle
        computers' memory there while host memory is inside the control
        plane's squeeze window, so it must hold what the window can push: a
        window of 90-102 GiB on a 128 GiB host squeezes up to ~12 GiB of host
        memory, well inside the default 32 GiB. zram is the host's only swap:
        a swap device on disk would take guest memory to disk.
      '';
    };
    uplink = lib.mkOption {
      type = lib.types.str;
      default = "eth0";
      description = "Interface guests' traffic leaves by.";
    };
    dns = lib.mkOption {
      type = lib.types.nonEmptyListOf lib.types.str;
      default = [
        "1.1.1.1"
        "8.8.8.8"
      ];
      description = "Resolvers handed to guests; their link has none.";
    };
    controlPlane = lib.mkOption {
      default = null;
      description = "A control plane on the tailnet guests may reach; null allows none.";
      type = lib.types.nullOr (
        lib.types.submodule {
          options = {
            address = lib.mkOption {
              type = lib.types.str;
              description = "Its Tailscale IPv4 address.";
            };
            ports = lib.mkOption {
              type = lib.types.listOf lib.types.port;
              description = "TCP ports guests may reach on it.";
            };
          };
        }
      );
    };
    guestDestinations = lib.mkOption {
      default = [ ];
      description = "Private IPv4 address and TCP port pairs guests may reach despite the private-range drop.";
      type = lib.types.listOf (
        lib.types.submodule {
          options = {
            address = lib.mkOption {
              type = lib.types.str;
              description = "IPv4 address.";
            };
            port = lib.mkOption {
              type = lib.types.port;
              description = "TCP port.";
            };
          };
        }
      );
    };
    tunnel = lib.mkOption {
      default = null;
      description = ''
        WireGuard tunnel the control plane reaches the API through (as in
        incus-host.nix): the gateway initiates, the host only answers. Null
        serves the API on the NIC to `apiSources` (dev only, S-17).
      '';
      type = lib.types.nullOr (
        lib.types.submodule {
          options = {
            address = lib.mkOption {
              type = lib.types.str;
              example = "10.99.0.3/24";
              description = "The host's tunnel address in CIDR form.";
            };
            listenPort = lib.mkOption {
              type = lib.types.port;
              # Also the default of infra/stacks/firecracker-host's `tunnelPort`.
              default = 51820;
              description = "UDP port the tunnel listens on, open on the uplink.";
            };
            mtu = lib.mkOption {
              type = lib.types.ints.positive;
              # GCP's VPC MTU is 1460; WireGuard adds up to 80 bytes.
              default = 1380;
              description = "MTU of the tunnel interface.";
            };
            privateKeyFile = lib.mkOption {
              type = lib.types.str;
              example = "/var/lib/macro/wg.key";
              description = "Path of the host's WireGuard private key (root 0600, outside the Nix store).";
            };
            peer = {
              publicKey = lib.mkOption {
                type = lib.types.str;
                description = "The gateway's WireGuard public key.";
              };
              address = lib.mkOption {
                type = lib.types.str;
                description = "The gateway's tunnel IPv4 address, the only source admitted to the API port.";
              };
              endpointSources = lib.mkOption {
                type = lib.types.listOf lib.types.str;
                description = "Public IPv4 addresses the gateway's handshakes come from; the only sources admitted to `listenPort`.";
              };
            };
          };
        }
      );
    };
    moves = lib.mkOption {
      default = null;
      description = ''
        Computer moves between hosts (ZFS only): a WireGuard mesh with the
        other hosts (`${movesInterface}`) and the agent's move listener on
        it. Null turns both off.
      '';
      type = lib.types.nullOr (
        lib.types.submodule {
          options = {
            address = lib.mkOption {
              type = lib.types.str;
              example = "10.88.0.2/24";
              description = "This host's mesh address in CIDR form; the listener binds to it.";
            };
            port = lib.mkOption {
              type = lib.types.port;
              default = 8446;
              description = "TCP port of the move listener, open only on the mesh to its peers.";
            };
            connectTimeout = lib.mkOption {
              type = lib.types.ints.positive;
              default = 10;
              description = "Seconds connecting to another host's listener may take.";
            };
            mtu = lib.mkOption {
              type = lib.types.ints.positive;
              # GCP's VPC MTU is 1460 and WireGuard adds up to 80 bytes; at
              # 1420 large packets fragment and a stream fell to ~126 KB/s.
              # A GCP-Hetzner path is bounded by the GCP side.
              default = 1380;
              description = "MTU of the mesh interface.";
            };
            listenPort = lib.mkOption {
              type = lib.types.port;
              default = 51821;
              description = "UDP port of the mesh, open on the uplink to the peers' endpoints only.";
            };
            privateKeyFile = lib.mkOption {
              type = lib.types.str;
              example = "/var/lib/macro/wg-moves.key";
              description = "Path of the host's mesh private key (root 0600, outside the Nix store).";
            };
            peers = lib.mkOption {
              description = "The other hosts computers move to or from.";
              type = lib.types.listOf (
                lib.types.submodule {
                  options = {
                    publicKey = lib.mkOption {
                      type = lib.types.str;
                      description = "Its mesh public key.";
                    };
                    address = lib.mkOption {
                      type = lib.types.str;
                      description = "Its mesh IPv4 address.";
                    };
                    endpoint = lib.mkOption {
                      type = lib.types.str;
                      example = "203.0.113.9:51821";
                      description = "Its public IPv4 address and mesh UDP port.";
                    };
                  };
                }
              );
            };
          };
        }
      );
    };
    sshSources = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      # IAP's TCP forwarding range.
      default = [ "35.235.240.0/20" ];
      description = "IPv4 sources admitted to SSH on the uplink: IAP on GCP; an administration bastion's addresses elsewhere.";
    };
    healthCheckInterval = lib.mkOption {
      type = lib.types.str;
      default = "30s";
      description = "How often the host checks its own agent over mTLS; a failed check restarts the agent (its VMs keep running).";
    };
    datadog = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Run the Datadog agent: OTLP from the host agent on 127.0.0.1:4317, its journal, host metrics. Off only in tests.";
      };
      apiKeyFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "/var/lib/macro/datadog-api-key";
        description = "Path of the Datadog API key (root 0400, outside the Nix store).";
      };
    };
    otlpEndpoint = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      default = if cfg.datadog.enable then "http://127.0.0.1:4317" else null;
      defaultText = lib.literalExpression ''if datadog.enable then "http://127.0.0.1:4317" else null'';
      example = "http://10.0.0.5:4317";
      description = "Where the host agent sends its spans (OTLP gRPC): the local Datadog agent by default, or a collector on a host without one. Null sends none.";
    };
    alloy = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = false;
        description = "Run Grafana Alloy: host metrics and each computer's CPU, memory and disk IO from its VM's cgroup, written to Macro's Prometheus for the fleet dashboard. Nothing runs in guests.";
      };
      remoteWriteUrl = lib.mkOption {
        type = lib.types.str;
        default = "https://otlp.macro-internal.com/api/v1/write";
        description = "Prometheus remote-write endpoint of the observability stack (infra/stacks/observability).";
      };
      passwordFile = lib.mkOption {
        type = lib.types.nullOr lib.types.str;
        default = null;
        example = "/var/lib/macro/metrics-remote-write-password";
        description = "Path of the remote-write password (root 0400, outside the Nix store).";
      };
    };
    environment = lib.mkOption {
      type = lib.types.enum [
        "local"
        "develop"
        "production"
      ];
      default = "develop";
      description = "`ENVIRONMENT` of the agent (tracing setup) and the Datadog `env` tag.";
    };
  };

  config = lib.mkMerge [
    {
      assertions = [
        {
          assertion =
            !(builtins.elem cfg.listenAddress [
              "0.0.0.0"
              ""
            ]);
          message = "The Firecracker host agent must listen on a specific address, never a wildcard.";
        }
        {
          assertion =
            !(lib.any (user: user.uid != null && vmIds user.uid) (lib.attrValues config.users.users))
            && !(lib.any (group: group.gid != null && vmIds group.gid) (lib.attrValues config.users.groups))
            && !(lib.any (user: lib.any rangeOverlapsVmIds (user.subUidRanges ++ user.subGidRanges)) (
              lib.attrValues config.users.users
            ));
          message = "A user, group or subordinate id range falls in the Firecracker VMs' range (${toString uidBase} + slots).";
        }
        {
          # Swap files and partitions alike: guest memory never goes to disk.
          assertion = config.swapDevices == [ ];
          message = "Firecracker hosts swap only to zram (macro.firecrackerHost.zramPercent); swapDevices must be empty.";
        }
        {
          assertion = cfg.datadog.enable -> cfg.datadog.apiKeyFile != null;
          message = "macro.firecrackerHost.datadog.apiKeyFile is required with the Datadog agent on.";
        }
        {
          assertion = cfg.datadog.apiKeyFile == null || !(lib.hasPrefix "/nix/store/" cfg.datadog.apiKeyFile);
          message = "The Datadog API key must not be in the Nix store.";
        }
        {
          assertion = cfg.alloy.enable -> cfg.alloy.passwordFile != null;
          message = "macro.firecrackerHost.alloy.passwordFile is required with Alloy on.";
        }
        {
          assertion = cfg.alloy.passwordFile == null || !(lib.hasPrefix "/nix/store/" cfg.alloy.passwordFile);
          message = "The remote-write password must not be in the Nix store.";
        }
      ]
      ++ lib.optionals (cfg.moves != null) [
        {
          assertion = cfg.storage.kind == "zfs";
          message = "Moves send ZFS datasets: they need storage.kind = \"zfs\".";
        }
        {
          assertion =
            lib.hasPrefix "/" cfg.moves.privateKeyFile
            && !(lib.hasPrefix "/nix/store/" cfg.moves.privateKeyFile);
          message = "The move mesh's private key must be an absolute path outside the Nix store.";
        }
      ]
      ++ lib.optionals (cfg.tunnel != null) [
        {
          assertion =
            lib.hasPrefix "/" cfg.tunnel.privateKeyFile
            && !(lib.hasPrefix "/nix/store/" cfg.tunnel.privateKeyFile);
          message = "The WireGuard private key must be an absolute path outside the Nix store.";
        }
        {
          assertion = builtins.head (lib.splitString "/" cfg.tunnel.address) == cfg.listenAddress;
          message = "With a tunnel, the agent must listen on the tunnel address.";
        }
        {
          assertion = cfg.apiSources == [ cfg.tunnel.peer.address ];
          message = "With a tunnel, the API's only source is the tunnel peer.";
        }
      ];

      boot.kernelModules = [
        "kvm-intel"
        "tun"
      ];

      # The squeeze's only swap, in RAM. The agent fails its swap health
      # check (and stops squeezing) if anything else swaps.
      zramSwap = {
        enable = true;
        algorithm = "zstd";
        memoryPercent = cfg.zramPercent;
      };

      # S-12 and friends: the host runs nothing but the agent, its VMs and
      # their Firecracker processes.
      boot.kernel.sysctl = {
        "net.ipv4.ip_forward" = 1;
        # io_uring is a large attack surface; the drives use the Sync engine.
        "kernel.io_uring_disabled" = 2;
        "kernel.yama.ptrace_scope" = 2;
        "kernel.dmesg_restrict" = 1;
        "kernel.kptr_restrict" = 2;
        "kernel.unprivileged_bpf_disabled" = 1;
        "net.core.bpf_jit_harden" = 2;
        "kernel.perf_event_paranoid" = 3;
        "kernel.sysrq" = 0;
        # The File memory backend never uses userfaultfd (S-13).
        "vm.unprivileged_userfaultfd" = 0;
        "fs.protected_fifos" = 2;
        "fs.protected_regular" = 2;
        "fs.suid_dumpable" = 0;
      };
      # kexec_load_disabled and no hibernation.
      security.protectKernelImage = true;
      # No user namespaces: neither the jailer (it is root) nor the agent
      # uses them. Nix sandboxing needs them, so the host never builds:
      # closures arrive from the deploying machine.
      security.allowUserNamespaces = false;
      nix.settings.sandbox = false;
      nix.settings.max-jobs = 0;
      # No lockdown=integrity: nixpkgs' kernel is built without the lockdown
      # LSM, so the parameter would be ignored.
      boot.kernelParams = [ "quiet" ];
      boot.consoleLogLevel = lib.mkDefault 1;

      # KSM stays off (S-7): merging across VMs is a timing side channel, and
      # the golden's shared page cache already shares idle pages.
      hardware.ksm.enable = false;
      systemd.tmpfiles.rules = [ "w /sys/kernel/mm/ksm/run - - - - 0" ];

      environment.systemPackages = [
        pkgs.nftables
        pkgs.jq
        firecrackerRelease
      ];

      networking.nftables.enable = true;
      networking.firewall.enable = false;

      # The host's own input, scoped to the uplink and the tunnel; it never
      # filters the host's output or the VMs' interfaces (the agent's tables
      # do those).
      networking.nftables.tables.macro-firecracker-host = {
        family = "inet";
        content = ''
          chain input {
            type filter hook input priority filter; policy accept;
            iifname "lo" accept
            iifname "${cfg.uplink}" jump wan_to_host
            ${lib.optionalString (cfg.tunnel != null) ''iifname "${tunnelInterface}" jump tunnel_to_host''}
            ${lib.optionalString (
              cfg.moves != null && cfg.moves.peers != [ ]
            ) ''iifname "${movesInterface}" jump moves_to_host''}
          }

          # The cloud firewall admits only IAP SSH, the tunnel and the
          # control plane; this is the second wall.
          chain wan_to_host {
            ct state established,related accept
            ip protocol icmp accept
            udp dport 68 accept
            ${lib.optionalString (
              cfg.sshSources != [ ]
            ) "ip saddr { ${lib.concatStringsSep ", " cfg.sshSources} } tcp dport 22 accept"}
            ${
              if cfg.tunnel != null then
                "ip saddr { ${lib.concatStringsSep ", " cfg.tunnel.peer.endpointSources} } udp dport ${toString cfg.tunnel.listenPort} accept"
              else
                "ip saddr { ${lib.concatStringsSep ", " cfg.apiSources} } tcp dport ${toString cfg.port} accept"
            }
            ${lib.optionalString (cfg.moves != null && cfg.moves.peers != [ ])
              "ip saddr { ${lib.concatStringsSep ", " movesEndpointSources} } udp dport ${toString cfg.moves.listenPort} accept"
            }
            counter drop
          }

          ${lib.optionalString (cfg.moves != null && cfg.moves.peers != [ ]) ''
            chain moves_to_host {
              ct state established,related accept
              ip saddr { ${
                lib.concatStringsSep ", " (map (peer: peer.address) cfg.moves.peers)
              } } tcp dport ${toString cfg.moves.port} accept
              counter drop
            }
          ''}
          ${lib.optionalString (cfg.tunnel != null) ''
            chain tunnel_to_host {
              ct state established,related accept
              ip saddr ${cfg.tunnel.peer.address} tcp dport ${toString cfg.port} accept
              counter drop
            }
          ''}
        '';
      };

      networking.wireguard.interfaces = {
        ${tunnelInterface} = lib.mkIf (cfg.tunnel != null) {
          ips = [ cfg.tunnel.address ];
          inherit (cfg.tunnel) mtu listenPort privateKeyFile;
          peers = [
            {
              inherit (cfg.tunnel.peer) publicKey;
              allowedIPs = [ "${cfg.tunnel.peer.address}/32" ];
            }
          ];
        };
        ${movesInterface} = lib.mkIf (cfg.moves != null) {
          ips = [ cfg.moves.address ];
          inherit (cfg.moves) mtu listenPort privateKeyFile;
          peers = map (peer: {
            inherit (peer) publicKey endpoint;
            allowedIPs = [ "${peer.address}/32" ];
          }) cfg.moves.peers;
        };
      };

      # The server certificate the control plane pins, and the client
      # certificate of the health check, made once.
      systemd.services.firecracker-host-certificate = {
        description = "Firecracker host agent TLS certificates";
        wantedBy = [ "multi-user.target" ];
        before = [ "firecracker-host.service" ];
        path = [ pkgs.openssl ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
          UMask = "0077";
        };
        script = ''
          mkdir -p ${tlsDirectory}
          if [ ! -s ${tlsDirectory}/server.crt ]; then
            openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-384 -nodes -days 3650 \
              -subj "/CN=${config.networking.hostName}-firecracker-host" \
              -addext "subjectAltName=IP:${cfg.listenAddress}" \
              -addext "extendedKeyUsage=serverAuth" \
              -keyout ${tlsDirectory}/server.key -out ${tlsDirectory}/server.crt
          fi
          if [ ! -s ${tlsDirectory}/health.crt ]; then
            openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-384 -nodes -days 3650 \
              -subj "/CN=${config.networking.hostName}-firecracker-host-health" \
              -addext "extendedKeyUsage=clientAuth" \
              -keyout ${tlsDirectory}/health.key -out ${tlsDirectory}/health.crt
          fi
          chmod 0400 ${tlsDirectory}/server.key ${tlsDirectory}/health.key
          chmod 0444 ${tlsDirectory}/server.crt ${tlsDirectory}/health.crt
        '';
      };

      systemd.services.firecracker-host = {
        description = "Firecracker host agent for Macro computers";
        wantedBy = [ "multi-user.target" ];
        requires = [
          "firecracker-host-certificate.service"
          "firecracker-host-storage.service"
        ];
        after = [
          "network-online.target"
          "nftables.service"
          "firecracker-host-certificate.service"
          "firecracker-host-storage.service"
        ];
        wants = [ "network-online.target" ];
        # A reload of nftables flushes the agent's tables: restart it to put
        # them back (its VMs keep running).
        partOf = [ "nftables.service" ];
        # Keep restarting a crashing agent: its VMs run on without it.
        startLimitIntervalSec = 0;
        unitConfig.RequiresMountsFor = [
          cfg.imagesDir
        ]
        ++ lib.optional (cfg.storage.kind == "xfs") cfg.storage.xfsDirectory;
        path = [
          pkgs.iproute2
          pkgs.nftables
          pkgs.procps
          pkgs.e2fsprogs
        ]
        ++ lib.optional (cfg.storage.kind == "zfs") config.boot.zfs.package;
        environment = {
          ENVIRONMENT = cfg.environment;
          DD_SERVICE = "firecracker-host";
          DD_ENV = cfg.environment;
          RUST_LOG = "info";
        }
        # Spans and metrics go to the local Datadog agent, or the collector
        # `otlpEndpoint` names; host.name joins them to the host's own
        # metrics and to the fleet's host rows.
        // lib.optionalAttrs (cfg.otlpEndpoint != null) {
          OTEL_EXPORTER_OTLP_ENDPOINT = cfg.otlpEndpoint;
          OTEL_RESOURCE_ATTRIBUTES = "host.name=${config.networking.hostName}";
        };
        serviceConfig = {
          ExecStart = "${cfg.package}/bin/firecracker-host serve --config ${configFile}";
          # Keys reach the agent as root-only credentials, never as files a
          # user owns (S-18).
          LoadCredential = [
            "tls-certificate:${tlsDirectory}/server.crt"
            "tls-key:${tlsDirectory}/server.key"
            "client-health:${tlsDirectory}/health.crt"
          ]
          ++ lib.imap0 (index: path: "client-${toString index}:${path}") cfg.clientCertificates;
          # VMs live in <unit>/vms and outlive the agent: only the agent's own
          # process is stopped, and cgroup v2 wants it in a leaf.
          Delegate = "yes";
          DelegateSubgroup = "agent";
          KillMode = "process";
          # The agent outlives any VM under memory pressure. Its jailer
          # children inherit this, and the agent resets them to 0.
          OOMScoreAdjust = -1000;
          Restart = "always";
          RestartSec = 2;
        };
      };

      # The agent answers its own API over mTLS, or it is restarted. A
      # restart keeps every VM running (KillMode=process).
      systemd.services.firecracker-host-health = {
        description = "Firecracker host agent health check";
        after = [ "firecracker-host.service" ];
        requisite = [ "firecracker-host.service" ];
        onFailure = [ "firecracker-host-restart.service" ];
        path = [ pkgs.coreutils ];
        serviceConfig.Type = "oneshot";
        script = ''
          for attempt in 1 2 3; do
            if timeout 10 ${cfg.package}/bin/firecracker-host client --endpoint ${healthEndpoint} host > /dev/null; then
              exit 0
            fi
            echo "health check attempt $attempt failed"
            sleep 5
          done
          echo "the agent did not answer its API three times; restarting it"
          exit 1
        '';
      };
      systemd.timers.firecracker-host-health = {
        wantedBy = [ "timers.target" ];
        timerConfig = {
          OnActiveSec = "2min";
          OnUnitActiveSec = cfg.healthCheckInterval;
        };
      };
      systemd.services.firecracker-host-restart = {
        description = "Restart the Firecracker host agent after a failed health check";
        serviceConfig = {
          Type = "oneshot";
          ExecStart = "${config.systemd.package}/bin/systemctl restart firecracker-host.service";
        };
      };
    }

    (lib.mkIf (cfg.moves != null) {
      # One zfs send stream over ~90 ms RTT needs more than the default
      # 4 MiB socket buffers (~47 MB/s at that cap).
      boot.kernel.sysctl = {
        "net.core.rmem_max" = 67108864;
        "net.core.wmem_max" = 67108864;
        "net.ipv4.tcp_rmem" = "4096 131072 67108864";
        "net.ipv4.tcp_wmem" = "4096 16384 67108864";
      };
    })

    (lib.mkIf (cfg.storage.kind == "zfs") {
      # Computers are dataset clones; hibernation and golden builds still
      # move files with block cloning (the agent checks the same at start).
      # Block cloning had corruption fixes through 2.2.4 and is on by
      # default from 2.3; the hosts were measured on 2.4.
      assertions = [
        {
          assertion = lib.versionAtLeast config.boot.zfs.package.version minimumZfsVersion;
          message = "Firecracker hosts need OpenZFS >= ${minimumZfsVersion} (block cloning); boot.zfs.package is ${config.boot.zfs.package.version}.";
        }
        {
          assertion = zfsKernelModule.version == config.boot.zfs.package.version;
          message = "ZFS userland ${config.boot.zfs.package.version} and kernel module ${zfsKernelModule.version} must be one release.";
        }
      ];
      boot.supportedFilesystems = [ "zfs" ];
      boot.zfs.extraPools = [ zfsPool ];
      boot.zfs.forceImportRoot = false;
      # Block cloning on, and a clone of dirty data waits for it (both the
      # 2.4 defaults, pinned so a default change can't turn them off); the
      # storage unit and the agent refuse to go on otherwise.
      boot.kernelParams = [
        "zfs.zfs_arc_max=${toString cfg.storage.arcMaxBytes}"
        "zfs.zfs_bclone_enabled=1"
        "zfs.zfs_bclone_wait_dirty=1"
      ];
      services.zfs.autoScrub.enable = true;
      services.zfs.trim.enable = true;

      # The parent dataset, with the settings the agent's children inherit;
      # then the checks the agent repeats, so a host with unsafe or missing
      # block cloning fails at boot, in this unit's log.
      systemd.services.firecracker-host-storage = {
        description = "Firecracker host ZFS dataset and block cloning";
        wantedBy = [ "multi-user.target" ];
        after = [
          "zfs-import.target"
          "zfs-mount.service"
        ];
        requires = [ "zfs-import.target" ];
        path = [
          config.boot.zfs.package
          pkgs.jq
        ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = ''
          dataset=${lib.escapeShellArg cfg.storage.zfsDataset}
          pool=${lib.escapeShellArg zfsPool}
          if ! zfs list -H -o name "$dataset" > /dev/null 2>&1; then
            zfs create -p -o compression=lz4 -o atime=off -o xattr=sa "$dataset"
          fi
          if [ "$(zfs get -H -o value mounted "$dataset")" != yes ]; then
            zfs mount "$dataset"
          fi
          feature=$(zpool get -H -o value feature@block_cloning "$pool")
          case "$feature" in
            enabled|active) ;;
            *) echo "pool $pool: feature@block_cloning is '$feature'; run zpool upgrade $pool" >&2; exit 1 ;;
          esac
          for parameter in zfs_bclone_enabled zfs_bclone_wait_dirty; do
            if [ "$(cat /sys/module/zfs/parameters/$parameter)" != 1 ]; then
              echo "$parameter is not 1: block cloning is off or unsafe" >&2
              exit 1
            fi
          done
          # Userland and kernel module from one release (a mismatch has run
          # on hosts before), and at least the pinned version.
          userland=$(zfs version -j | jq -r '.zfs_version.userland')
          kernel=$(zfs version -j | jq -r '.zfs_version.kernel')
          if [ "''${userland#zfs-}" != "''${kernel#zfs-kmod-}" ]; then
            echo "ZFS userland $userland does not match the kernel module $kernel" >&2
            exit 1
          fi
        '';
      };
    })

    (lib.mkIf (cfg.storage.kind == "xfs") {
      assertions = [
        {
          assertion = (config.fileSystems.${cfg.storage.xfsDirectory}.fsType or null) == "xfs";
          message = "macro.firecrackerHost.storage.xfsDirectory needs its own XFS filesystem (reflinks and hard links of goldens).";
        }
      ];
      environment.systemPackages = [ pkgs.xfsprogs ];
      systemd.services.firecracker-host-storage = {
        description = "Firecracker host XFS filesystem";
        unitConfig.RequiresMountsFor = [ cfg.storage.xfsDirectory ];
        path = [ pkgs.xfsprogs ];
        serviceConfig = {
          Type = "oneshot";
          RemainAfterExit = true;
        };
        script = ''
          if ! xfs_info ${lib.escapeShellArg cfg.storage.xfsDirectory} | grep -q 'reflink=1'; then
            echo "${cfg.storage.xfsDirectory} has no reflink" >&2
            exit 1
          fi
        '';
      };
    })

    (lib.mkIf cfg.datadog.enable {
      services.datadog-agent = {
        enable = true;
        # The OTLP receiver is a build tag nixpkgs leaves out.
        package = pkgs.datadog-agent.override { extraTags = [ "otlp" ]; };
        apiKeyFile = cfg.datadog.apiKeyFile;
        site = "us5.datadoghq.com";
        # The same name the agent registers with (`host_name`), so host
        # metrics, spans and the fleet's per-host series join.
        hostname = config.networking.hostName;
        tags = [ "env:${cfg.environment}" ];
        enableTraceAgent = true;
        extraConfig = {
          logs_enabled = true;
          otlp_config.receiver.protocols.grpc.endpoint = "127.0.0.1:4317";
          otlp_config.metrics.enabled = true;
          otlp_config.traces.enabled = true;
        };
        checks.journald.logs = [
          {
            type = "journald";
            include_units = [
              "firecracker-host.service"
              "firecracker-host-storage.service"
              "firecracker-host-health.service"
            ];
            service = "firecracker-host";
            source = "firecracker-host";
          }
        ];
      };
      users.users.datadog.extraGroups = [ "systemd-journal" ];
    })

    (lib.mkIf cfg.alloy.enable {
      services.alloy = {
        enable = true;
        configPath = pkgs.writeText "firecracker-host.alloy" (
          lib.replaceStrings
            [
              "@HOST@"
              "@ENVIRONMENT@"
              "@REMOTE_WRITE_URL@"
            ]
            [
              config.networking.hostName
              cfg.environment
              cfg.alloy.remoteWriteUrl
            ]
            (builtins.readFile ./firecracker-host.alloy)
        );
        extraFlags = [
          "--server.http.listen-addr=127.0.0.1:12345"
          "--disable-reporting"
        ];
      };
      systemd.services.alloy.serviceConfig = {
        # The password reaches Alloy as a root-only credential, like the
        # agent's keys (S-18).
        LoadCredential = [ "remote-write-password:${cfg.alloy.passwordFile}" ];
        # Metrics never starve computers of memory.
        MemoryMax = "512M";
      };
    })
  ];
}
