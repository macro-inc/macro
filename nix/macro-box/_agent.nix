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
  # The agent's browser profile: its logins survive restarts and image
  # updates on the data disk.
  browserProfile = "${home}/browser";
  # macro's own desktop is :0.
  displayNumber = 1;
  # The runtime closure, shared with the teammate runtime image.
  shared = import ./_teammate-runtime.nix {
    inherit pkgs;
    inherit (cfg) runtime;
    computerUse = cfg.computerUse.package;
    inherit (config.macro.box) claudeCode;
    paths = {
      inherit
        workspace
        lastGood
        failures
        bootHead
        desktopRuntime
        displayNumber
        ;
      helperCredentials = "/run/credentials/macro-agent.service/agent.env";
      setupTraceparent = "/run/macrod/agent-traceparent";
      setupTraceparentUsed = "${state}/setup-traceparent";
      # Unused here: `claude` is the system profile's, over the same file.
      claudeCredential = "${claudeSignIn}/credential.json";
    };
  };
  inherit (shared)
    runtimePath
    startAgent
    agentStopped
    desktopEnvironment
    mcpServers
    display
    vncPort
    browserCdpUrl
    ;
  # The agent's desktop (its bus, AT-SPI and sound) runs outside macro's
  # user session, which would let it out of its sandbox: its sockets live
  # here, and nothing of /run/user/${uid} is in its view.
  desktopRuntime = "/run/macro-agent";
  # Every process of the agent and its desktop has this primary group, and
  # the firewall keeps it off macro's own desktop and browser.
  agentGroup = "macro-agent";
  # harnessd's Claude sign-in (`credential.json`), which the `claude`
  # wrapper reads.
  claudeSignIn = "${config.macro.box.harnessd.stateDirectory}/claude";

  environment = shared.environment // {
    HOME = home;
    # %d: the unit's credentials directory, where LoadCredential puts agent.env.
    MUPPET_CREDENTIALS_FILE = "%d/agent.env";
    MUPPET_RESTART_FILE = restartFile;
    # Bound read-only below; the runtime binds it into Claude's sandbox.
    HARNESSD_STATE_DIRECTORY = claudeSignIn;
  };

  # The agent and every unit of its desktop: macro's uid with the agent's
  # group, of /home and /run/user only its own home, no privilege gain, and
  # one /tmp shared by them (only the :1 socket in it). The desktop units
  # restart on their own.
  sandbox = {
    Slice = "macro-agent.slice";
    User = "macro";
    Group = agentGroup;
    UMask = "0077";
    NoNewPrivileges = true;
    CapabilityBoundingSet = "";
    AmbientCapabilities = "";
    ProtectSystem = "strict";
    ProtectHome = "tmpfs";
    BindPaths = [ home ];
    ReadWritePaths = [ desktopRuntime ];
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
    Restart = "always";
    RestartSec = 2;
  };
  hardening = sandbox // {
    # The token `claude` reads.
    BindReadOnlyPaths = [ claudeSignIn ];
    MemoryMax = "75%";
    TasksMax = 4096;
    LoadCredential = "agent.env:${agentEnvironment}";
    RestartSec = 5;
    RestartSteps = 5;
    RestartMaxDelaySec = 60;
  };
  agentUnit = {
    wants = [
      "network-online.target"
      "macrod-enroll.service"
    ]
    ++ desktopUnits;
    after = [
      "network-online.target"
      "macrod-enroll.service"
    ]
    ++ desktopUnits;
    path = runtimePath ++ [
      "/run/wrappers"
      "/run/current-system/sw"
    ];
    inherit environment;
    unitConfig = {
      ConditionPathExists = agentEnvironment;
      StartLimitIntervalSec = 0;
      JoinsNamespaceOf = "macro-agent-display.service";
    };
  };

  desktopUnits = [
    "macro-agent-display.service"
    "macro-agent-openbox.service"
    "macro-agent-bus.service"
    "macro-agent-sound.service"
    "macro-agent-browser.service"
  ];
  # A unit of the agent's desktop; all but the display join its /tmp.
  desktopService = description: service: extra: {
    inherit description;
    wantedBy = [ "multi-user.target" ];
    environment = desktopEnvironment // {
      HOME = home;
    };
    unitConfig = {
      StartLimitIntervalSec = 0;
    }
    // lib.optionalAttrs (description != displayDescription) {
      JoinsNamespaceOf = "macro-agent-display.service";
    };
    serviceConfig = sandbox // service;
  }
  // extra;
  displayDescription = "Agent teammate display (Xvnc ${display} on 127.0.0.1:${toString vncPort})";
  afterDisplay = {
    bindsTo = [ "macro-agent-display.service" ];
    after = [ "macro-agent-display.service" ];
  };
  waitForDisplay = pkgs.writeShellScript "wait-for-agent-display" ''
    until [ -S /tmp/.X11-unix/X${toString displayNumber} ]; do sleep 0.2; done
  '';
in
{
  options.macro.box.agent = {
    runtime = lib.mkOption {
      type = lib.types.package;
      default = import ./_agent-runtime.nix { inherit pkgs; };
      description = "node_modules for the starter agent, with @macro-inc/muppet and @macro-inc/sdk.";
    };
    computerUse = {
      package = lib.mkOption {
        type = lib.types.package;
        default = import ./_computer-use-linux.nix { inherit pkgs; };
        description = "computer-use-linux, built from source at a pinned release.";
      };
    };
    mcpServers = lib.mkOption {
      type = lib.types.attrsOf json.type;
      readOnly = true;
      default = mcpServers;
      description = "The stdio MCP servers the runtime adds to its Claude Code query (MUPPET_MCP_SERVERS_JSON).";
    };
  };

  # Only an agent teammate's computer runs it.
  config = lib.mkIf config.macro.box.agentMode {
    environment.systemPackages = [ cfg.computerUse.package ];
    users.groups.${agentGroup} = { };
    # macro's own desktop and browser are for macro's sessions, not the
    # agent (its group), whose sandbox they would let it out of.
    networking.firewall.extraCommands = lib.concatMapStrings (iptables: ''
      ${iptables} -w -N macro-agent-out 2>/dev/null || ${iptables} -w -F macro-agent-out
      ${iptables} -w -A macro-agent-out -p tcp -m multiport --dports 5900,9222 -m owner --gid-owner ${agentGroup} -j REJECT --reject-with tcp-reset
      ${iptables} -w -C OUTPUT -o lo -j macro-agent-out 2>/dev/null || ${iptables} -w -I OUTPUT -o lo -j macro-agent-out
    '') [ "iptables" "ip6tables" ];
    networking.firewall.extraStopCommands = lib.concatMapStrings (iptables: ''
      ${iptables} -w -D OUTPUT -o lo -j macro-agent-out 2>/dev/null || true
    '') [ "iptables" "ip6tables" ];
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
      ${desktopRuntime}.d = {
        user = "macro";
        group = agentGroup;
        mode = "0700";
      };
      # Bound into the agent's unit, so it exists before the first sign-in.
      ${claudeSignIn}.d = {
        user = "macro";
        group = "macro";
        mode = "0700";
      };
      ${browserProfile}.d = {
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
        # Code that needs a newer image (start-agent's 79) can't start on this
        # one, and has nothing to roll back to: no retrying. It starts again
        # when the computer boots a newer image.
        RestartPreventExitStatus = 79;
        # A call is a child process; a restart must not hang up on anyone.
        KillMode = "process";
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

    # The agent's own desktop for computer use, beside macro's :0. Only :1's
    # filesystem socket is in its /tmp; no abstract one.
    systemd.services.macro-agent-display = desktopService displayDescription {
      ExecStart = shared.displayCommand;
    } { };
    # Whatever its menu starts stays in the sandbox.
    systemd.services.macro-agent-openbox = desktopService "Openbox on the agent teammate's display" {
      ExecStartPre = waitForDisplay;
      ExecStart = lib.getExe' pkgs.openbox "openbox";
    } afterDisplay;
    systemd.services.macro-agent-bus = desktopService "The agent teammate's session bus, with AT-SPI" {
      ExecStart = shared.busCommand;
    } afterDisplay;
    systemd.services.macro-agent-sound = desktopService "The agent teammate's sound server" {
      ExecStart = shared.soundCommand;
    } {
      environment = desktopEnvironment // {
        HOME = home;
        PULSE_RUNTIME_PATH = "${desktopRuntime}/pulse";
      };
    };
    # The agent's browser, on its desktop (so a screen share shows it), with
    # DevTools on loopback only and AT-SPI on for computer use.
    systemd.services.macro-agent-browser =
      desktopService "Agent teammate's Chromium on ${display}, DevTools on ${browserCdpUrl}"
        {
          ExecStartPre = waitForDisplay;
          ExecStart = shared.browserCommand browserProfile;
        }
        {
          bindsTo = [ "macro-agent-display.service" ];
          after = [
            "macro-agent-display.service"
            "macro-agent-openbox.service"
            "macro-agent-bus.service"
            "macro-agent-sound.service"
          ];
          wants = [
            "macro-agent-bus.service"
            "macro-agent-sound.service"
          ];
        };
  };
}
