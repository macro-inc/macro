# Firecracker host for Macro computers: the host agent
# (services/firecracker_host) restoring computers from golden snapshots in
# jailed Firecracker microVMs, one netns each. An alternative to
# incus-host.nix; a host runs one or the other.
#
# The agent creates its netns slots and nftables tables itself at start
# (prefix `fch`); this module adds the host's own input policy, the
# binaries, the durable XFS requirement, TLS and the unit.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.firecrackerHost;
  version = "v1.18.0";
  # Release binaries, pinned: firecracker, jailer.
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
  # VM slot n runs as uidBase + n (the golden slot is n = slots): clear of
  # system users, nixbld and subuid ranges.
  uidBase = 1000000000;
  vmIds = id: id >= uidBase && id <= uidBase + cfg.slots;
  credentials = "/run/credentials/firecracker-host.service";
  configFile = (pkgs.formats.toml { }).generate "firecracker-host.toml" {
    host_name = config.networking.hostName;
    listen = "${cfg.listenAddress}:${toString cfg.port}";
    tls = {
      certificate = "${credentials}/tls-certificate";
      key = "${credentials}/tls-key";
      client_certificates = lib.imap0 (index: _: "${credentials}/client-${toString index}") cfg.clientCertificates;
    };
    binaries = {
      firecracker = "${firecrackerRelease}/bin/firecracker";
      jailer = "${firecrackerRelease}/bin/jailer";
      firecracker_version = version;
    };
    storage = {
      durable_dir = cfg.durableDir;
      images_dir = cfg.imagesDir;
    };
    network = {
      slots = cfg.slots;
      prefix = "fch";
      veth_base = "10.201.0.0";
      inherit (cfg) dns uplink;
      api_sources = cfg.apiSources;
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
  };
in
{
  options.macro.firecrackerHost = {
    package = lib.mkOption {
      type = lib.types.package;
      description = "The firecracker-host agent (`packages.<system>.firecracker-host`).";
    };
    listenAddress = lib.mkOption {
      type = lib.types.str;
      description = "IPv4 address the agent API listens on (port `port`); the tunnel or NIC address, never a wildcard.";
    };
    port = lib.mkOption {
      type = lib.types.port;
      default = 8444;
      description = "Agent API port.";
    };
    apiSources = lib.mkOption {
      type = lib.types.listOf lib.types.str;
      description = "IPv4 sources (the control plane's egress or tunnel peer) admitted to the API port.";
    };
    clientCertificates = lib.mkOption {
      type = lib.types.listOf lib.types.path;
      description = "PEM client certificates of control planes; a client must present one byte for byte.";
    };
    durableDir = lib.mkOption {
      type = lib.types.str;
      default = "/var/lib/firecracker-host";
      description = "Everything the agent keeps; must be an XFS filesystem with reflink on a persistent disk.";
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
    environment = lib.mkOption {
      type = lib.types.enum [
        "local"
        "develop"
        "production"
      ];
      default = "develop";
      description = "`ENVIRONMENT` of the agent (tracing setup).";
    };
  };

  config = {
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
          && !(lib.any (group: group.gid != null && vmIds group.gid) (lib.attrValues config.users.groups));
        message = "A user or group id falls in the Firecracker VMs' range (${toString uidBase} + slots).";
      }
      {
        assertion = (config.fileSystems.${cfg.durableDir}.fsType or null) == "xfs";
        message = "macro.firecrackerHost.durableDir needs its own XFS filesystem (reflinks and hard links of goldens).";
      }
    ];

    boot.kernelModules = [
      "kvm-intel"
      "tun"
    ];
    boot.kernel.sysctl."net.ipv4.ip_forward" = 1;
    # KSM stays off: merging across VMs is a timing side channel, and the
    # golden's shared page cache already shares idle pages.
    hardware.ksm.enable = false;

    environment.systemPackages = [
      pkgs.xfsprogs
      pkgs.nftables
      pkgs.jq
    ];

    networking.nftables.enable = true;
    networking.firewall.enable = false;

    # The host's own input. The agent adds its tables (guests, the API
    # port's sources, metadata for non-root) when it starts.
    networking.nftables.tables.macro-firecracker-host = {
      family = "inet";
      content = ''
        chain input {
          type filter hook input priority filter; policy accept;
          iifname "lo" accept
          iifname "${cfg.uplink}" jump wan_to_host
        }

        # GCP's firewall admits only IAP on tcp/22 and the control plane on
        # the API port; this is the second wall.
        chain wan_to_host {
          ct state established,related accept
          ip protocol icmp accept
          udp dport 68 accept
          ip saddr 35.235.240.0/20 tcp dport 22 accept
          ip saddr { ${lib.concatStringsSep ", " cfg.apiSources} } tcp dport ${toString cfg.port} accept
          counter drop
        }
      '';
    };

    # A self-signed certificate the control plane pins, made once.
    systemd.services.firecracker-host-certificate = {
      description = "Firecracker host agent TLS certificate";
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
        chmod 0400 ${tlsDirectory}/server.key
        chmod 0444 ${tlsDirectory}/server.crt
      '';
    };

    systemd.services.firecracker-host = {
      description = "Firecracker host agent for Macro computers";
      wantedBy = [ "multi-user.target" ];
      requires = [ "firecracker-host-certificate.service" ];
      after = [
        "network-online.target"
        "nftables.service"
        "firecracker-host-certificate.service"
      ];
      wants = [ "network-online.target" ];
      # A reload of nftables flushes the agent's tables: restart it to put
      # them back (its VMs keep running).
      partOf = [ "nftables.service" ];
      unitConfig.RequiresMountsFor = [
        cfg.durableDir
        cfg.imagesDir
      ];
      path = [
        pkgs.iproute2
        pkgs.nftables
        pkgs.procps
        # mkfs.ext4 for the empty /home templates.
        pkgs.e2fsprogs
      ];
      environment = {
        ENVIRONMENT = cfg.environment;
        DD_SERVICE = "firecracker-host";
        DD_ENV = cfg.environment;
        RUST_LOG = "info";
      };
      serviceConfig = {
        ExecStart = "${cfg.package}/bin/firecracker-host serve --config ${configFile}";
        # Keys reach the agent as root-only credentials, never as files a
        # user owns.
        LoadCredential = [
          "tls-certificate:${tlsDirectory}/server.crt"
          "tls-key:${tlsDirectory}/server.key"
        ]
        ++ lib.imap0 (index: path: "client-${toString index}:${path}") cfg.clientCertificates;
        # VMs live in <unit>/vms and outlive the agent: only the agent's own
        # process is stopped, and cgroup v2 wants it in a leaf.
        Delegate = "yes";
        DelegateSubgroup = "agent";
        KillMode = "process";
        Restart = "always";
        RestartSec = 2;
      };
    };
  };
}
