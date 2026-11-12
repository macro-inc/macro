# The agent teammate (packages/starter-agent on packages/muppet): one agent
# per computer. `macrod enroll` writes the agent's environment to
# `agentEnvironment` when the enrollment carries an agent and rewrites it on
# re-enrollment; without an agent the file is absent and nothing runs.
#
# It runs as macro, the user harnessd keeps Claude's sign-in for, but in a
# hardened system unit: its own home under ~macro/agent and nothing else of
# /home, no privilege gain (so no sudo), no capabilities. agent.env reaches
# it as a systemd credential, never as process environment.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box.agent;
  json = pkgs.formats.json { };
  user = config.users.users.macro;
  uid = toString user.uid;
  agentEnvironment = "/var/lib/macrod/agent.env";
  # HOME for the agent: its Claude Code settings and git config are its own.
  home = "${user.home}/agent";
  workspace = "${home}/workspace";
  state = "${home}/state";
  lastGood = "${state}/last-good";
  failures = "${state}/failed-boots";
  bootHead = "${state}/boot-head";
  restartFile = "${home}/.restart";
  runtimeDirectory = "/run/user/${uid}";
  # Where harnessd keeps the Claude sign-in token `claude` reads (#10186).
  harnessdState = "/home/.system/harnessd";
  display = ":${toString cfg.display}";
  vncPort = 5900 + cfg.display;

  ffmpegX11grab = pkgs.runCommand "ffmpeg-x11grab" { } ''
    mkdir -p $out/bin
    ln -s ${pkgs.ffmpeg-full}/bin/ffmpeg $out/bin/ffmpeg-x11grab
  '';
  # What the runtime and its call-share screen run by name. `claude` comes
  # from the system profile, where the image installs the wrapper that reads
  # harnessd's sign-in.
  runtimePath = [
    pkgs.bun
    pkgs.git
    pkgs.coreutils
    pkgs.chromium
    pkgs.xvfb
    pkgs.pulseaudio
    pkgs.ffmpeg-headless
    ffmpegX11grab
  ];
  scriptVariables = ''
    workspace=${workspace}
    last_good=${lastGood}
    failures=${failures}
    boot_head=${bootHead}
    max_failed_boots=${toString cfg.maxFailedBoots}
    runtime=${cfg.runtime}
    helper=${lib.getExe credentialHelper}
    helper_credentials=/run/credentials/macro-agent.service/agent.env
  '';
  credentialHelper = pkgs.writeShellApplication {
    name = "git-credential-agent";
    runtimeInputs = [
      pkgs.gnused
      pkgs.coreutils
    ];
    text = builtins.readFile ./files/git-credential-agent;
  };
  startAgent = pkgs.writeShellApplication {
    name = "start-agent";
    runtimeInputs = runtimePath ++ [
      pkgs.gnused
      pkgs.diffutils
    ];
    text = scriptVariables + builtins.readFile ./files/start-agent;
  };
  agentStopped = pkgs.writeShellApplication {
    name = "agent-stopped";
    runtimeInputs = [ pkgs.coreutils ];
    text = scriptVariables + builtins.readFile ./files/agent-stopped;
  };

  # Stdio MCP servers the runtime adds to its Claude Code query.
  mcpServers = lib.optionalAttrs cfg.computerUse.enable {
    computer-use-linux = {
      type = "stdio";
      command = lib.getExe cfg.computerUse.package;
      args = [ "mcp" ];
      env = {
        DISPLAY = display;
        XDG_RUNTIME_DIR = runtimeDirectory;
        DBUS_SESSION_BUS_ADDRESS = "unix:path=${runtimeDirectory}/bus";
        # The agent's desktop is plain X11 under Openbox.
        COMPUTER_USE_LINUX_SCREENSHOT_BACKEND = "x11";
      };
    };
  };

  environment = {
    HOME = home;
    AGENT_SHELL = "1";
    AGENT_WORKSPACE = workspace;
    # %d: the unit's credentials directory, where LoadCredential puts agent.env.
    MUPPET_CREDENTIALS_FILE = "%d/agent.env";
    MUPPET_LAST_GOOD_FILE = lastGood;
    MUPPET_RESTART_FILE = restartFile;
    MUPPET_MCP_SERVERS_JSON = builtins.toJSON mcpServers;
    DISPLAY = display;
    XDG_RUNTIME_DIR = runtimeDirectory;
    DBUS_SESSION_BUS_ADDRESS = "unix:path=${runtimeDirectory}/bus";
    # Chromium and GTK expose AT-SPI trees for computer use.
    ACCESSIBILITY_ENABLED = "1";
    AGENT_SCREEN_FONTS = "${pkgs.noto-fonts-cjk-sans}:${pkgs.noto-fonts-color-emoji}";
    LIVEKIT_FFMPEG_PATH = lib.getExe pkgs.ffmpeg-headless;
    # LiveKit's native modules link libstdc++.
    LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
  };

  hardening = {
    User = "macro";
    Group = "macro";
    UMask = "0077";
    NoNewPrivileges = true;
    CapabilityBoundingSet = "";
    AmbientCapabilities = "";
    ProtectSystem = "strict";
    # Of /home and /run/user: its own home, macro's session bus and the
    # token `claude` reads.
    ProtectHome = "tmpfs";
    BindPaths = [
      home
      runtimeDirectory
    ];
    BindReadOnlyPaths = [ "-${harnessdState}" ];
    # macro is in the docker group, which is root on this machine: the
    # daemon's sockets are out of reach.
    InaccessiblePaths = [
      "-/run/docker.sock"
      "-/run/docker"
      "-/run/containerd"
    ];
    PrivateTmp = true;
    PrivateDevices = true;
    ProtectKernelTunables = true;
    ProtectKernelModules = true;
    ProtectKernelLogs = true;
    ProtectControlGroups = true;
    ProtectClock = true;
    ProtectHostname = true;
    ProtectProc = "invisible";
    RestrictSUIDSGID = true;
    RestrictRealtime = true;
    LockPersonality = true;
    SystemCallArchitectures = "native";
    RestrictAddressFamilies = [
      "AF_UNIX"
      "AF_INET"
      "AF_INET6"
      "AF_NETLINK"
    ];
    # Not RestrictNamespaces (Chromium's sandbox makes user namespaces) or
    # MemoryDenyWriteExecute (bun and V8 JIT).
    MemoryMax = cfg.memoryMax;
    TasksMax = 4096;
    LoadCredential = "agent.env:${agentEnvironment}";
    Restart = "always";
    RestartSec = 5;
    RestartSteps = 5;
    RestartMaxDelaySec = 60;
  };
  agentUnit = {
    wants = [
      "network-online.target"
      "macrod-enroll.service"
      "user@${uid}.service"
    ];
    after = [
      "network-online.target"
      "macrod-enroll.service"
      "user@${uid}.service"
    ];
    path = runtimePath ++ [
      "/run/wrappers"
      "/run/current-system/sw"
    ];
    inherit environment;
    unitConfig = {
      ConditionPathExists = agentEnvironment;
      StartLimitIntervalSec = 0;
    };
  };

  userService = description: service: {
    inherit description;
    wantedBy = [ "default.target" ];
    unitConfig.ConditionUser = "macro";
    serviceConfig = {
      Restart = "always";
      RestartSec = 2;
    }
    // service;
  };
  waitForDisplay = pkgs.writeShellScript "wait-for-agent-display" ''
    until [ -S /tmp/.X11-unix/X${toString cfg.display} ]; do sleep 0.2; done
  '';
in
{
  options.macro.box.agent = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Run the agent teammate when enrollment writes ${agentEnvironment}.";
    };
    runtime = lib.mkOption {
      type = lib.types.package;
      default = import ./_agent-runtime.nix { inherit pkgs; };
      description = "node_modules for the starter agent, with @macro-inc/muppet and @macro-inc/sdk.";
    };
    computerUse = {
      enable = lib.mkOption {
        type = lib.types.bool;
        default = true;
        description = "Give the agent computer-use-linux as a stdio MCP server on its own display.";
      };
      package = lib.mkOption {
        type = lib.types.package;
        default = import ./_computer-use-linux.nix { inherit pkgs; };
        description = "computer-use-linux, built from source at a pinned release.";
      };
    };
    display = lib.mkOption {
      type = lib.types.ints.between 1 99;
      default = 1;
      description = "The agent's X display (Xvnc; VNC on 127.0.0.1:5900 + display).";
    };
    mcpServers = lib.mkOption {
      type = lib.types.attrsOf json.type;
      readOnly = true;
      default = mcpServers;
      description = "The stdio MCP servers the runtime adds to its Claude Code query (MUPPET_MCP_SERVERS_JSON).";
    };
    maxFailedBoots = lib.mkOption {
      type = lib.types.ints.positive;
      default = 3;
      description = "Failed boots in a row before the launcher resets the workspace to last-good.";
    };
    memoryMax = lib.mkOption {
      type = lib.types.str;
      default = "75%";
      description = "MemoryMax of the agent and its screen.";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.computerUse.package ];
    # The AT-SPI bus, activated on macro's session bus.
    services.gnome.at-spi2-core.enable = true;
    fonts.packages = [
      pkgs.noto-fonts-cjk-sans
      pkgs.noto-fonts-color-emoji
    ];

    systemd.tmpfiles.settings."20-macro-agent" = {
      ${home}.d = {
        user = "macro";
        group = "macro";
        mode = "0700";
      };
      ${state}.d = {
        user = "macro";
        group = "macro";
        mode = "0700";
      };
      # Claude Code's first-run screens never show in a service.
      "${home}/.claude.json" = {
        C.argument = toString (
          pkgs.writeText "agent-claude.json" (builtins.toJSON { hasCompletedOnboarding = true; })
        );
        Z = {
          user = "macro";
          group = "macro";
          mode = "0600";
        };
      };
    };

    systemd.services.macro-agent = agentUnit // {
      description = "Macro agent teammate";
      wantedBy = [ "multi-user.target" ];
      serviceConfig = hardening // {
        WorkingDirectory = home;
        ExecStart = "${lib.getExe startAgent} run";
        ExecStopPost = lib.getExe agentStopped;
        # A call is a child process; a restart must not hang up on anyone.
        KillMode = "process";
        # The agent's desktop, for computer use.
        BindReadOnlyPaths = hardening.BindReadOnlyPaths ++ [ "/tmp/.X11-unix" ];
      };
    };

    # The browser the agent shares on calls, on a private Xvfb of its own. It
    # outlives the agent's restarts, as calls do.
    systemd.services.macro-agent-screen = agentUnit // {
      description = "Macro agent teammate's call-share screen";
      wantedBy = [ "multi-user.target" ];
      after = agentUnit.after ++ [ "macro-agent.service" ];
      serviceConfig = hardening // {
        WorkingDirectory = home;
        ExecStart = "${lib.getExe startAgent} screen";
        TimeoutStopSec = 15;
        LogRateLimitIntervalSec = 60;
        LogRateLimitBurst = 50;
      };
    };

    # A new, rewritten or removed agent environment, or the runtime's restart
    # marker after a land, restarts the agent (a removed file fails its
    # condition, so it stays stopped).
    systemd.paths.macro-agent = {
      description = "Watch the agent environment and its restart marker";
      wantedBy = [ "multi-user.target" ];
      pathConfig = {
        PathChanged = [
          agentEnvironment
          restartFile
        ];
        Unit = "macro-agent-restart.service";
      };
    };
    systemd.services.macro-agent-restart = {
      description = "Restart the agent teammate";
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe' config.systemd.package "systemctl"} restart --no-block macro-agent.service";
      };
    };

    # The agent's own desktop for computer use, beside macro's :0.
    systemd.user.services.macro-agent-display =
      userService "Agent teammate display (Xvnc ${display} on 127.0.0.1:${toString vncPort})"
        {
          ExecStart = "${pkgs.tigervnc}/bin/Xvnc ${display} -geometry 1920x1080 -depth 24 -rfbport ${toString vncPort} -interface 127.0.0.1 -localhost -SecurityTypes None -UseBlacklist 0 -AlwaysShared -nolisten tcp";
        };
    systemd.user.services.macro-agent-openbox =
      userService "Openbox on the agent teammate's display" {
        ExecStartPre = waitForDisplay;
        ExecStart = lib.getExe' pkgs.openbox "openbox";
      }
      // {
        bindsTo = [ "macro-agent-display.service" ];
        after = [ "macro-agent-display.service" ];
        environment.DISPLAY = display;
      };
  };
}
