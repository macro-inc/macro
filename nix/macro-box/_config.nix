# Structured guest configuration; scripts and documentation remain in files/.
{
  pkgs,
  rootUuid,
  espUuid,
  snapshot,
}:
let
  inherit (pkgs) lib;
  ini = pkgs.formats.ini { };
  json = pkgs.formats.json { };
  # Formats without a nixpkgs format use the standard key/value generator.
  keyValue =
    separator:
    lib.generators.toKeyValue {
      mkKeyValue = lib.generators.mkKeyValueDefault { } separator;
    };
  units = {
    "etc/systemd/user/macro-chromium.service" = {
      "Unit" = {
        "Description" = "Chromium on the Macro display, DevTools on 127.0.0.1:9222";
        "BindsTo" = "macro-display.service";
        "After" = "macro-display.service macro-openbox.service";
      };
      "Service" = {
        "Environment" = "DISPLAY=:0";
        "ExecStartPre" = "/bin/sh -c 'until [ -S /tmp/.X11-unix/X0 ]; do sleep 0.2; done'";
        "ExecStart" =
          "/usr/local/bin/chromium    --user-data-dir=%h/.config/chromium    --remote-debugging-port=9222    --no-first-run    --no-default-browser-check    --disable-dev-shm-usage    --password-store=basic    --start-maximized";
        "Restart" = "always";
        "RestartSec" = "2";
      };
      "Install" = {
        "WantedBy" = "default.target";
      };
    };
    "etc/systemd/user/macro-openbox.service" = {
      "Unit" = {
        "Description" = "Openbox window manager on the Macro display";
        "BindsTo" = "macro-display.service";
        "After" = "macro-display.service";
      };
      "Service" = {
        "Environment" = "DISPLAY=:0";
        "ExecStartPre" = "/bin/sh -c 'until [ -S /tmp/.X11-unix/X0 ]; do sleep 0.2; done'";
        "ExecStart" = "/usr/bin/openbox";
        "Restart" = "always";
        "RestartSec" = "2";
      };
      "Install" = {
        "WantedBy" = "default.target";
      };
    };
    "etc/systemd/user/macro-display.service" = {
      "Unit" = {
        "Description" = "Macro computer display (Xvnc :0 on 127.0.0.1:5900)";
      };
      "Service" = {
        "ExecStart" =
          "/usr/bin/Xtigervnc :0 -geometry 1920x1080 -depth 24 -rfbport 5900 -interface 127.0.0.1 -localhost -SecurityTypes None -UseBlacklist 0 -AlwaysShared -nolisten tcp";
        "Restart" = "always";
        "RestartSec" = "2";
      };
      "Install" = {
        "WantedBy" = "default.target";
      };
    };
    "etc/systemd/system/macrod.service" = {
      "Unit" = {
        "Description" = "Macro agent daemon";
        # Enrollment installs macrod-token-store; macrod reads the Claude
        # token from its socket on start.
        "After" = "network-online.target macrod-enroll.service macrod-token-store.service";
        "Wants" = "network-online.target macrod-token-store.service";
        "Requires" = "macrod-enroll.service";
        "ConditionPathExists" = "/var/lib/macrod/enrolled";
        # Never give up; RestartSteps backs off instead.
        "StartLimitIntervalSec" = "0";
      };
      "Service" = {
        "User" = "macro";
        "Group" = "macro";
        "Environment" = "HOME=/home/macro";
        "WorkingDirectory" = "/home/macro/work";
        "ExecStart" =
          "/usr/local/bin/macrod service --ignore-stdin-eof --config /home/macro/.macrod/macrod.toml --workspace /home/macro/work";
        "Restart" = "always";
        "RestartSec" = "1";
        "RestartSteps" = "5";
        "RestartMaxDelaySec" = "30";
      };
      "Install" = {
        "WantedBy" = "multi-user.target";
      };
    };
    "etc/systemd/system/incus-agent.service" = {
      "Unit" = {
        "Description" = "Incus - agent";
        "Documentation" = "https://linuxcontainers.org/incus/docs/main/";
        "ConditionPathExists" = "/dev/virtio-ports/org.linuxcontainers.incus";
        "Before" = "cloud-init.target cloud-init.service cloud-init-local.service";
        "DefaultDependencies" = "no";
      };
      "Service" = {
        "Type" = "notify";
        "WorkingDirectory" = "-/run/incus_agent";
        "ExecStartPre" = "/usr/lib/macro-box/incus-agent-setup";
        "ExecStart" = "/run/incus_agent/incus-agent";
        "Restart" = "on-failure";
        "RestartSec" = "5s";
        "StartLimitInterval" = "60";
        "StartLimitBurst" = "10";
      };
      "Install" = {
        "WantedBy" = "multi-user.target";
      };
    };
    "etc/systemd/system/macrod-enroll.service" = {
      "Unit" = {
        "Description" = "Join this computer to Macro";
        "Documentation" = "file:///etc/macro/README";
        "After" = "network-online.target incus-agent.service";
        "Wants" = "network-online.target";
        "Before" = "macrod.service";
        "ConditionPathExists" = "!/var/lib/macrod/enrolled";
      };
      "Service" = {
        "Type" = "oneshot";
        "RemainAfterExit" = "yes";
        "Environment" = "HOME=/home/macro";
        "EnvironmentFile" = "/etc/macro/enroll.env";
        "ExecStartPre" = "/usr/lib/macro-box/check-enrollment-source";
        "ExecStart" =
          "/usr/local/bin/macrod enroll --from \${MACRO_ENROLL_FROM} --config /home/macro/.macrod/macrod.toml";
        "StandardOutput" = "journal+console";
        "StandardError" = "journal+console";
      };
      "Install" = {
        "WantedBy" = "multi-user.target";
      };
    };
    "etc/systemd/system/macro-box-growroot.service" = {
      "Unit" = {
        "Description" = "Grow the root partition to the Incus disk size";
        "ConditionVirtualization" = "vm";
        "After" = "systemd-remount-fs.service";
      };
      "Service" = {
        "Type" = "oneshot";
        "RemainAfterExit" = "yes";
        "ExecStart" = "/usr/lib/macro-box/growroot";
      };
      "Install" = {
        "WantedBy" = "multi-user.target";
      };
    };
    "etc/systemd/network/80-macro-box.network" = {
      "Match" = {
        "Name" = "en* eth*";
      };
      "Network" = {
        "DHCP" = "yes";
      };
    };
    "etc/systemd/system/systemd-networkd.service.d/macro-box.conf" = {
      "Unit" = {
        "ConditionVirtualization" = "!container";
      };
    };
    "etc/systemd/system/getty@.service.d/macro-box.conf" = {
      "Unit" = {
        "ConditionVirtualization" = "!container";
      };
    };
    "etc/systemd/system/systemd-networkd-wait-online.service.d/macro-box.conf" = {
      "Unit" = {
        "ConditionVirtualization" = "!container";
      };
    };
    "etc/systemd/system/systemd-networkd.socket.d/macro-box.conf" = {
      "Unit" = {
        "ConditionVirtualization" = "!container";
      };
    };
    "etc/systemd/system/systemd-resolved.service.d/macro-box.conf" = {
      "Unit" = {
        "ConditionVirtualization" = "!container";
      };
    };
  };
  claude = json.generate "claude.json" {
    "hasCompletedOnboarding" = true;
    "mcpServers" = {
      "chrome-devtools" = {
        "type" = "stdio";
        "command" = "/usr/local/bin/chrome-devtools-mcp";
        "args" = [
          "--browser-url"
          "http://127.0.0.1:9222"
        ];
      };
    };
  };
  files = lib.mapAttrs (path: value: ini.generate (baseNameOf path) value) units // {
    "etc/claude-code/managed-settings.json" = json.generate "managed-settings.json" {
      "$schema" = "https://json.schemastore.org/claude-code-settings.json";
      "env" = {
        "DISABLE_AUTOUPDATER" = "1";
      };
      "permissions" = {
        "deny" = [
          "Bash(xmrig:*)"
          "Bash(xmr-stak:*)"
          "Bash(cpuminer:*)"
          "Bash(minerd:*)"
          "Bash(t-rex:*)"
          "Bash(nbminer:*)"
          "Bash(curl http://169.254.169.254:*)"
          "Bash(curl 169.254.169.254:*)"
        ];
      };
    };
    "etc/skel/.claude.json" = claude;
    "etc/sysctl.d/60-macro-box.conf" = pkgs.writeText "macro-box-sysctl.conf" (
      keyValue " = " {
        # Chromium's sandbox needs unprivileged user namespaces.
        "kernel.apparmor_restrict_unprivileged_userns" = 0;
      }
    );
    "etc/macro/enroll.env" = pkgs.writeText "enroll.env" (
      keyValue "=" {
        MACRO_ENROLL_FROM = "incus";
      }
    );
    "etc/hostname" = pkgs.writeText "hostname" (
      lib.generators.toKeyValue {
        mkKeyValue = _: value: value;
      } { hostname = "macro-computer"; }
    );
    "etc/locale.gen" = pkgs.writeText "locale.gen" (
      keyValue " " {
        "en_US.UTF-8" = "UTF-8";
      }
    );
    "etc/fstab" = pkgs.writeText "fstab" (
      lib.generators.toKeyValue
        {
          mkKeyValue =
            mount: fs:
            lib.concatStringsSep " " [
              "UUID=${fs.uuid}"
              mount
              fs.type
              (lib.concatStringsSep "," fs.options)
              "0"
              (toString fs.pass)
            ];
        }
        {
          "/" = {
            uuid = rootUuid;
            type = "ext4";
            options = [
              "defaults"
              "discard"
              "errors=remount-ro"
            ];
            pass = 1;
          };
          "/boot/efi" = {
            uuid = espUuid;
            type = "vfat";
            options = [
              "umask=0077"
              "nofail"
            ];
            pass = 1;
          };
        }
    );
    "etc/apt/sources.list.d/ubuntu.sources" = pkgs.writeText "ubuntu.sources" (
      lib.concatMapStringsSep "\n" (keyValue ": ") [
        {
          Types = "deb";
          URIs = "http://archive.ubuntu.com/ubuntu";
          Suites = "noble noble-updates noble-backports";
          Components = "main restricted universe multiverse";
          Signed-By = "/usr/share/keyrings/ubuntu-archive-keyring.gpg";
        }
        {
          Types = "deb";
          URIs = "http://security.ubuntu.com/ubuntu";
          Suites = "noble-security";
          Components = "main restricted universe multiverse";
          Signed-By = "/usr/share/keyrings/ubuntu-archive-keyring.gpg";
        }
      ]
    );
    "etc/sudoers.d/macro" = pkgs.writeText "macro-sudoers" (
      lib.generators.toKeyValue
        {
          mkKeyValue =
            user: rule:
            "${user} ${rule.hosts}=(${rule.runAs}) ${lib.concatStringsSep ":" rule.tags}:${lib.concatStringsSep "," rule.commands}";
        }
        {
          macro = {
            hosts = "ALL";
            runAs = "ALL";
            tags = [ "NOPASSWD" ];
            commands = [ "ALL" ];
          };
        }
    );
    "etc/udev/rules.d/99-incus-agent.rules" = pkgs.writeText "incus-agent.rules" (
      lib.concatStringsSep ", " (
        map
          (
            rule:
            lib.removeSuffix "\n" (
              lib.generators.toKeyValue {
                mkKeyValue = key: value: "${key}${value.operator}${builtins.toJSON value.value}";
              } rule
            )
          )
          [
            {
              ACTION = {
                operator = "==";
                value = "add";
              };
            }
            {
              SYMLINK = {
                operator = "==";
                value = "virtio-ports/org.linuxcontainers.incus";
              };
            }
            {
              TAG = {
                operator = "+=";
                value = "systemd";
              };
            }
            {
              "ENV{SYSTEMD_WANTS}" = {
                operator = "+=";
                value = "incus-agent.service";
              };
            }
          ]
      )
      + "\n"
    );
  };
  rendered = pkgs.runCommand "macro-box-config" { } (
    lib.concatStringsSep "\n" (
      lib.mapAttrsToList (path: source: ''
        install -Dm0644 ${source} "$out/${path}"
      '') files
    )
  );
in
rec {
  inherit files rendered;
  artifacts = pkgs.linkFarm "macro-box-config-artifacts" [
    {
      name = "rootfs";
      path = rendered;
    }
    {
      name = "metadata.yaml";
      path = metadata;
    }
    {
      name = "grub.cfg";
      path = grub;
    }
    {
      name = "docker-enroll.env";
      path = dockerEnrollment;
    }
  ];
  dockerEnrollment = pkgs.writeText "docker-enroll.env" (
    keyValue "=" {
      MACRO_ENROLL_FROM = "file:/run/macro/enrollment.json";
    }
  );
  metadata = (pkgs.formats.yaml { }).generate "metadata.yaml" {
    architecture = "x86_64";
    creation_date = 1793836800;
    properties = {
      architecture = "amd64";
      description = "Macro computer (Ubuntu 24.04, snapshot ${snapshot})";
      os = "Ubuntu";
      release = "noble";
      variant = "macro-box";
      serial = snapshot;
    };
    templates = { };
  };
  grub = pkgs.writeText "grub.cfg" (
    lib.concatMapStrings
      (lib.generators.toKeyValue {
        mkKeyValue = key: value: key + lib.optionalString (value != "") " ${value}";
      })
      [
        { set = "timeout=0"; }
        { search = "--no-floppy --fs-uuid --set=root ${rootUuid}"; }
        { linux = "/boot/vmlinuz root=UUID=${rootUuid} ro console=tty1 console=ttyS0"; }
        { initrd = "/boot/initrd.img"; }
        { boot = ""; }
      ]
  );
}
