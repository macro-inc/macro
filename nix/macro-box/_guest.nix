# The Macro computer guest as a NixOS module: macrod, harnessd, Claude Code, herdr,
# Chromium on an Xvnc display, Docker and nix-ld. `_image.nix` adds the Incus
# VM image on top; `_vm-test.nix` boots this module alone.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box;
  json = pkgs.formats.json { };
  home = config.users.users.macro.home;
  workspace = "${home}/work";
  macrodConfig = "${home}/.macrod/macrod.toml";
  # macrod writes "<computer id>\n<generation>" here when enrollment succeeds.
  enrolledMarker = "/var/lib/macrod/enrolled";
  # /var/lib/macrod links here when there is a data disk.
  persistentMacrodState = if cfg.dataDisk == null then "/var/lib/macrod" else "/home/.system/macrod";
  # harnessd's state: the agents' credentials. On the data disk when there
  # is one, so a sign-in survives image updates.
  harnessdState = if cfg.dataDisk == null then "/var/lib/harnessd" else "/home/.system/harnessd";
  harnessdSocket = "/run/harnessd/harnessd.sock";
  claude = import ./_claude-wrapper.nix {
    inherit pkgs;
    inherit (cfg) claudeCode;
    credential = "${cfg.harnessd.stateDirectory}/claude/credential.json";
  };
  herdr = pkgs.callPackage "${cfg.herdrSource}/nix/package.nix" { };
  adapterDirectory = "${home}/.macrod/adapters/${cfg.claudeAgentAcp.adapterDirectory}";
  display = ":0";
  waitForDisplay = pkgs.writeShellScript "wait-for-display" ''
    until [ -S /tmp/.X11-unix/X0 ]; do sleep 0.2; done
  '';
  # Agents macrod starts look tools up on PATH, as in a login shell.
  systemPath = [
    "/run/wrappers"
    "/run/current-system/sw"
  ];
  claudeUserConfig = json.generate "claude.json" {
    hasCompletedOnboarding = true;
    mcpServers.chrome-devtools = {
      type = "stdio";
      command = lib.getExe cfg.chromeDevtoolsMcp;
      args = [
        "--browser-url"
        "http://127.0.0.1:9222"
      ];
    };
  };
  # Real copies (mode), not store symlinks: useradd copies /etc/skel and
  # Claude Code rewrites ~/.claude.json.
  skel = {
    "skel/.claude.json" = {
      source = claudeUserConfig;
      mode = "0644";
    };
    # herdr's official skill (Apache-2.0), with its license alongside.
    "skel/.claude/skills/herdr/SKILL.md" = {
      source = "${cfg.herdrSource}/skills/herdr/SKILL.md";
      mode = "0644";
    };
    "skel/.claude/skills/herdr/LICENSE" = {
      source = "${cfg.herdrSource}/LICENSE";
      mode = "0644";
    };
  }
  // lib.mapAttrs' (
    skill: _:
    lib.nameValuePair "skel/.claude/skills/${skill}/SKILL.md" {
      source = ./skills/${skill}/SKILL.md;
      mode = "0644";
    }
  ) (builtins.readDir ./skills);
  macroOwner = {
    user = "macro";
    group = "macro";
  };
  macroDirectory = macroOwner // {
    mode = "0755";
  };
  userService = description: service: {
    inherit description;
    wantedBy = [ "default.target" ];
    # The desktop is macro's, not every user's.
    unitConfig.ConditionUser = "macro";
    serviceConfig = {
      Restart = "always";
      RestartSec = 2;
    }
    // service;
  };
in
{
  options.macro.box = {
    macrod = lib.mkOption {
      type = lib.types.package;
      description = "The macrod package.";
    };
    harnessd.package = lib.mkOption {
      type = lib.types.package;
      description = "The harnessd package: agent sign-ins.";
    };
    harnessd.stateDirectory = lib.mkOption {
      type = lib.types.path;
      readOnly = true;
      default = harnessdState;
      description = ''
        Where harnessd keeps the agents' credentials (`claude/credential.json`
        for Claude): `/home/.system/harnessd` on the data disk, else
        `/var/lib/harnessd`.
      '';
    };
    claudeCode = lib.mkOption {
      type = lib.types.package;
      default = import ./_claude-code.nix { inherit pkgs; };
      description = "Claude Code, pinned for the models computers default to.";
    };
    claudeAgentAcp = lib.mkOption {
      type = lib.types.package;
      default = import ./_claude-agent-acp.nix { inherit pkgs; };
      description = "The Claude Code ACP adapter at macrod's pin.";
    };
    chromeDevtoolsMcp = lib.mkOption {
      type = lib.types.package;
      default = import ./_chrome-devtools-mcp.nix { inherit pkgs; };
      description = "The chrome-devtools MCP server.";
    };
    herdrSource = lib.mkOption {
      type = lib.types.path;
      description = "herdr's source at a release tag: its package and official agent skill.";
    };
    enrollFrom = lib.mkOption {
      type = lib.types.str;
      default = "incus";
      description = "`macrod enroll --from`: `incus` or `file:<path>`.";
    };
    agentMode = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = ''
        Run agents without administrator rights: the macro user loses
        passwordless sudo and the docker group. False keeps both.
      '';
    };
    dataDisk = lib.mkOption {
      type = lib.types.nullOr lib.types.str;
      # The Incus disk device named `data`.
      default = "/dev/disk/by-id/scsi-0QEMU_QEMU_HARDDISK_incus_data";
      description = ''
        Block device mounted at /home, formatted on first boot. It keeps
        homes and macrod's state across image updates; null keeps them on
        the root disk.
      '';
    };
  };

  config = {
    nixpkgs.config.allowUnfreePredicate = package: lib.getName package == "claude-code";

    networking.hostName = "macro-computer";
    networking.useNetworkd = true;
    # The guest has one NIC; the default waits for every link, up to 120 s.
    systemd.network.wait-online = {
      anyInterface = true;
      timeout = 30;
    };
    time.timeZone = "UTC";
    i18n.defaultLocale = "en_US.UTF-8";

    users.users.macro = {
      isNormalUser = true;
      uid = 1000;
      group = "macro";
      extraGroups = lib.optionals (!cfg.agentMode) [ "docker" ];
      shell = pkgs.bashInteractive;
      # Starts the display, window manager and browser at boot.
      linger = true;
    };
    users.groups.macro.gid = 1000;
    security.sudo.extraRules = lib.optionals (!cfg.agentMode) [
      {
        users = [ "macro" ];
        commands = [
          {
            command = "ALL";
            options = [ "NOPASSWD" ];
          }
        ];
      }
    ];

    environment.etc = skel // {
      "claude-code/CLAUDE.md".source = ./files/etc/claude-code/CLAUDE.md;
      "claude-code/managed-settings.json".source = json.generate "managed-settings.json" {
        "$schema" = "https://json.schemastore.org/claude-code-settings.json";
        env.DISABLE_AUTOUPDATER = "1";
        permissions.deny = [
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

    # Everything that must survive an image update lives on the data disk.
    fileSystems."/home" = lib.mkIf (cfg.dataDisk != null) {
      device = cfg.dataDisk;
      fsType = "ext4";
      autoFormat = true;
      autoResize = true;
      # Mounted before activation creates macro's home.
      neededForBoot = true;
    };
    systemd.tmpfiles.settings."05-macro-box-state" = lib.mkIf (cfg.dataDisk != null) {
      # The enrollment marker.
      "/var/lib/macrod"."L+".argument = persistentMacrodState;
    };

    systemd.tmpfiles.settings."10-macro-box" = {
      ${persistentMacrodState}.d.mode = "0755";
      ${cfg.harnessd.stateDirectory}.d = macroOwner // {
        mode = "0700";
      };
      ${workspace}.d = macroDirectory;
      "${home}/.config".d = macroDirectory;
      "${home}/.config/chromium".d = macroDirectory;
      "${home}/.macrod".d = macroDirectory;
      "${home}/.macrod/adapters".d = macroDirectory;
      "${home}/.macrod/adapters/@agentclientprotocol".d = macroDirectory;
      # Where macrod installs the ACP adapter, so it never runs npm.
      ${adapterDirectory}."L+".argument = "${cfg.claudeAgentAcp}";
      "${home}/.claude".d = macroDirectory;
      # Copied once, like useradd copies /etc/skel for a new user.
      "${home}/.claude.json" = {
        C.argument = "/etc/skel/.claude.json";
        Z = macroOwner;
      };
      "${home}/.claude/skills" = {
        C.argument = "/etc/skel/.claude/skills";
        Z = macroOwner;
      };
    };

    environment.systemPackages = [
      cfg.macrod
      cfg.harnessd.package
      # The pinned Claude Code behind the credential wrapper; harnessd runs
      # the unwrapped one.
      claude
      cfg.chromeDevtoolsMcp
      herdr
    ]
    ++ (with pkgs; [
      chromium
      nodejs_24
      python3
      uv
      git
      gcc
      gnumake
      pkg-config
      openssl
      curl
      wget
      jq
      unzip
      zip
      xz
      zstd
      file
      tmux
      rsync
      htop
      lsof
      psmisc
      vim
      openbox
      tigervnc
      xterm
      xset
    ]);
    fonts.packages = with pkgs; [
      dejavu_fonts
      liberation_ttf
      noto-fonts-color-emoji
    ];

    virtualisation.docker = {
      enable = true;
      # Started by docker.socket on first use, so dockerd and containerd stay
      # out of first boot, where they compete with enrollment for the CPU.
      enableOnBoot = false;
      # Images and containers survive image updates on the data disk.
      daemon.settings = lib.mkIf (cfg.dataDisk != null) {
        data-root = "/home/.system/docker";
      };
    };

    # Agents install with `nix shell` and `nix profile install`.
    nix.settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
    };

    # Downloaded binaries (Playwright browsers, uv's Python, release tarballs)
    # expect a glibc loader at /lib64 and common shared libraries.
    programs.nix-ld = {
      enable = true;
      libraries = with pkgs; [
        stdenv.cc.cc
        zlib
        zstd
        bzip2
        xz
        openssl
        curl
        icu
        libuuid
        libxml2
        expat
        glib
        nss
        nspr
        dbus
        atk
        at-spi2-atk
        at-spi2-core
        cups
        gtk3
        pango
        cairo
        gdk-pixbuf
        fontconfig
        freetype
        alsa-lib
        libdrm
        libgbm
        libGL
        libxkbcommon
        libx11
        libxcomposite
        libxdamage
        libxext
        libxfixes
        libxrandr
        libxcb
        libxshmfence
      ];
    };
    # `#!/bin/bash` and `#!/usr/bin/python3` shebangs resolve through PATH.
    services.envfs.enable = true;

    systemd.services.macrod-enroll = {
      description = "Join this computer to Macro";
      wantedBy = [ "multi-user.target" ];
      wants = [ "network-online.target" ];
      after = [
        "network-online.target"
        "incus-agent.service"
      ];
      before = [ "macrod.service" ];
      # Runs on every boot: `macrod enroll` re-enrolls for a newer
      # generation and keeps the existing enrollment otherwise.
      unitConfig.StartLimitIntervalSec = 0;
      path = systemPath;
      # Agent discovery records adapter paths usable by the daemon user.
      environment = {
        HOME = home;
        MACRO_ENROLL_FROM = cfg.enrollFrom;
        MACRO_ENROLLED_MARKER = enrolledMarker;
      };
      serviceConfig = {
        Type = "oneshot";
        RemainAfterExit = true;
        # macrod requires it; keep trying until the source shows up.
        Restart = "on-failure";
        RestartSec = 10;
        ExecStartPre = lib.getExe (
          pkgs.writeShellApplication {
            name = "check-enrollment-source";
            runtimeInputs = [
              pkgs.coreutils
              pkgs.curl
            ];
            text = builtins.readFile ./files/check-enrollment-source;
          }
        );
        ExecStart = "${lib.getExe' cfg.macrod "macrod"} enroll --from \${MACRO_ENROLL_FROM} --config ${macrodConfig}";
        # A retry that succeeds after boot gave up on macrod still starts it.
        # (OnSuccess= never fires: with RemainAfterExit the unit stays active.)
        ExecStartPost = "${lib.getExe' config.systemd.package "systemctl"} --no-block start macrod.service";
        StandardOutput = "journal+console";
        StandardError = "journal+console";
      };
    };

    systemd.services.macrod = {
      description = "Macro agent daemon";
      wantedBy = [ "multi-user.target" ];
      # Wants, not Requires: a first enroll attempt that fails must not fail
      # macrod's start for good; the enroll retry starts it once enrolled.
      wants = [
        "network-online.target"
        "macrod-enroll.service"
      ];
      after = [
        "network-online.target"
        "macrod-enroll.service"
      ];
      path = systemPath;
      environment.HOME = home;
      unitConfig = {
        ConditionPathExists = enrolledMarker;
        # Never give up; RestartSteps backs off instead.
        StartLimitIntervalSec = 0;
      };
      serviceConfig = {
        User = "macro";
        Group = "macro";
        WorkingDirectory = workspace;
        # --ignore-stdin-eof: systemd's closed stdin must not stop the daemon.
        ExecStart = "${lib.getExe' cfg.macrod "macrod"} service --ignore-stdin-eof --config ${macrodConfig} --workspace ${workspace}";
        Restart = "always";
        RestartSec = 1;
        RestartSteps = 5;
        RestartMaxDelaySec = 30;
      };
    };

    # Owns each agent's sign-in; the control plane runs `harnessd` (the
    # client) through the fleet's exec. See crates/harnessd/AGENTS.md.
    systemd.services.harnessd = {
      description = "Agent sign-ins on this computer";
      wantedBy = [ "multi-user.target" ];
      path = systemPath;
      environment.HOME = home;
      unitConfig.StartLimitIntervalSec = 0;
      serviceConfig = {
        User = "macro";
        Group = "macro";
        RuntimeDirectory = "harnessd";
        RuntimeDirectoryMode = "0700";
        ExecStart = "${lib.getExe' cfg.harnessd.package "harnessd"} serve --socket ${harnessdSocket} --state-dir ${cfg.harnessd.stateDirectory} --claude ${lib.getExe' cfg.claudeCode "claude"}";
        Restart = "always";
        RestartSec = 1;
      };
    };

    systemd.user.services.macro-display =
      userService "Macro computer display (Xvnc :0 on 127.0.0.1:5900)"
        {
          ExecStart = "${pkgs.tigervnc}/bin/Xvnc ${display} -geometry 1920x1080 -depth 24 -rfbport 5900 -interface 127.0.0.1 -localhost -SecurityTypes None -UseBlacklist 0 -AlwaysShared -nolisten tcp";
        };
    systemd.user.services.macro-openbox =
      userService "Openbox window manager on the Macro display" {
        ExecStartPre = waitForDisplay;
        ExecStart = lib.getExe' pkgs.openbox "openbox";
      }
      // {
        bindsTo = [ "macro-display.service" ];
        after = [ "macro-display.service" ];
        environment.DISPLAY = display;
      };
    systemd.user.services.macro-chromium =
      userService "Chromium on the Macro display, DevTools on 127.0.0.1:9222" {
        ExecStartPre = waitForDisplay;
        ExecStart = "${lib.getExe pkgs.chromium} --user-data-dir=%h/.config/chromium --remote-debugging-port=9222 --no-first-run --no-default-browser-check --disable-dev-shm-usage --password-store=basic --start-maximized";
      }
      // {
        bindsTo = [ "macro-display.service" ];
        after = [
          "macro-display.service"
          "macro-openbox.service"
        ];
        environment.DISPLAY = display;
      };

    system.stateVersion = "26.05";
  };
}
