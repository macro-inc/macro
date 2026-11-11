# The agent teammate's brain (packages/brain): one agent per computer, run as
# macro. `macrod enroll` writes the agent's environment to `agentEnvironment`
# when the enrollment carries an agent and rewrites it on re-enrollment;
# without an agent the file is absent and the brain does not run.
{
  config,
  lib,
  pkgs,
  ...
}:
let
  cfg = config.macro.box.brain;
  home = config.users.users.macro.home;
  agentEnvironment = "/var/lib/macrod/agent.env";
  # Not ~/work: that is macrod's coding workspace.
  workspace = "${home}/agent-workspace";
  credentialHelper = pkgs.writeShellApplication {
    name = "git-credential-brain";
    text = builtins.readFile ./files/git-credential-brain;
  };
  startBrain = pkgs.writeShellApplication {
    name = "start-brain";
    runtimeInputs = [
      pkgs.git
      pkgs.coreutils
    ];
    text = ''
      workspace=${workspace}
      health_port=${toString cfg.healthPort}
      helper=${lib.getExe credentialHelper}
      brain=${lib.getExe' cfg.package "brain"}
    ''
    + builtins.readFile ./files/start-brain;
  };
in
{
  options.macro.box.brain = {
    enable = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = "Run the agent brain when enrollment writes ${agentEnvironment}.";
    };
    package = lib.mkOption {
      type = lib.types.package;
      default = import ./_brain.nix { inherit pkgs; };
      description = "The brain runner, with its versioned library and dependencies.";
    };
    healthPort = lib.mkOption {
      type = lib.types.port;
      default = 7801;
      description = "Loopback port of the brain's /health and control routes (BRAIN_HEALTH_PORT).";
    };
  };

  config = lib.mkIf cfg.enable {
    environment.systemPackages = [ cfg.package ];

    systemd.services.macro-brain = {
      description = "Macro agent teammate brain";
      wantedBy = [ "multi-user.target" ];
      wants = [
        "network-online.target"
        "macrod-enroll.service"
      ];
      after = [
        "network-online.target"
        "macrod-enroll.service"
      ];
      # Turns find claude, git and the rest as in a login shell.
      path = [
        "/run/wrappers"
        "/run/current-system/sw"
      ];
      environment.HOME = home;
      unitConfig = {
        ConditionPathExists = agentEnvironment;
        StartLimitIntervalSec = 0;
      };
      serviceConfig = {
        User = "macro";
        Group = "macro";
        EnvironmentFile = agentEnvironment;
        WorkingDirectory = home;
        ExecStart = lib.getExe startBrain;
        Restart = "always";
        RestartSec = 5;
        RestartSteps = 5;
        RestartMaxDelaySec = 60;
        NoNewPrivileges = true;
        ProtectSystem = "strict";
        ReadWritePaths = [ home ];
        PrivateTmp = true;
      };
    };

    # A new or rewritten agent environment restarts the brain; a removed one
    # stops it (the restart's start fails its condition).
    systemd.paths.macro-brain = {
      description = "Watch the agent environment enrollment writes";
      wantedBy = [ "multi-user.target" ];
      pathConfig = {
        PathChanged = agentEnvironment;
        Unit = "macro-brain-restart.service";
      };
    };
    systemd.services.macro-brain-restart = {
      description = "Restart the brain for a new agent environment";
      serviceConfig = {
        Type = "oneshot";
        ExecStart = "${lib.getExe' config.systemd.package "systemctl"} restart --no-block macro-brain.service";
      };
    };
  };
}
