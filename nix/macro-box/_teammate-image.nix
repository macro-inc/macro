# The teammate runtime image: the agent teammate's runtime closure
# (`_teammate-runtime.nix`) as an OCI image for machines without a VM
# boundary, run by macrod with the flags in docs/design/teammate-runtime.md.
# uid 1000 `agent`, no capabilities, a read-only root; writable are only the
# agent volume (/teammate), tmpfs /tmp and /run/teammate-runtime.
# `nix build .#teammate-runtime-image && ./result | docker load`.
{
  pkgs,
  runtime,
  computerUse,
  claudeCode,
  # The launcher (crates/teammate_lifecycle): boots the workspace and execs
  # the runtime, as start-agent does on a hosted computer.
  teammateBoot,
}:
let
  inherit (pkgs) lib;
  uid = 1000;
  # The agent volume; a fresh named volume takes this directory's owner.
  volume = "/teammate";
  home = "${volume}/home";
  state = "${volume}/state";
  # The provider volume, read-only: `macrod teammate sign-in` writes
  # `claude/credential.json` there.
  provider = "/teammate-provider";
  # Holds only the bind of agent.env, so bubblewrap hides it whole.
  credentials = "/run/teammate";
  # tmpfs: the desktop's sockets (bus, PulseAudio).
  desktopRuntime = "/run/teammate-runtime/desktop";

  shared = import ./_teammate-runtime.nix {
    inherit
      pkgs
      runtime
      computerUse
      claudeCode
      ;
    inherit paths;
  };
  paths = {
    workspace = "${volume}/workspace";
    lastGood = "${state}/last-good";
    failures = "${state}/failed-boots";
    bootHead = "${state}/boot-head";
    helperCredentials = "${credentials}/agent.env";
    inherit desktopRuntime;
    displayNumber = 1;
    claudeCredential = "${provider}/claude/credential.json";
  };
  # teammate-boot's command line: start-agent's variables as flags; it reads
  # MUPPET_CREDENTIALS_FILE and TEAMMATE_PREVIOUS_EXIT (macrod's -e).
  bootCommand = [
    (lib.getExe' teammateBoot "teammate-boot")
    "run"
    "--workspace"
    paths.workspace
    "--last-good"
    paths.lastGood
    "--failed-boots"
    paths.failures
    "--boot-head"
    paths.bootHead
    "--runtime"
    "${runtime}"
    "--credential-helper"
    (lib.getExe shared.credentialHelper)
    "--helper-credentials"
    paths.helperCredentials
  ];

  tools = pkgs.buildEnv {
    name = "teammate-runtime-tools";
    paths = shared.runtimePath ++ [
      shared.claude
      teammateBoot
      shared.credentialHelper
      computerUse
      # What Claude Code's tools and capability scripts expect on PATH.
      pkgs.bashInteractive
      pkgs.findutils
      pkgs.gnugrep
      pkgs.gnused
      pkgs.gawk
      pkgs.diffutils
      pkgs.gnutar
      pkgs.gzip
      pkgs.which
      pkgs.procps
      pkgs.less
      pkgs.ripgrep
      pkgs.jq
      pkgs.curl
      # Enforced egress: macrod's holder runs `sleep`, its guard
      # `sh -c "nft -f - && nft -j list table inet macro_teammate"` in the
      # holder's network namespace; ip, capsh and ping are what the egress
      # test (files/teammate-egress-test) probes with.
      pkgs.nftables
      pkgs.iproute2
      pkgs.libcap
      pkgs.iputils
      # macrod resolves a local stack's service names in the holder with it.
      pkgs.getent
    ];
  };

  passwd = pkgs.writeTextDir "etc/passwd" ''
    root:x:0:0:root:/var/empty:/run/current-system/sw/bin/nologin
    agent:x:${toString uid}:${toString uid}:agent:${home}:${pkgs.bashInteractive}/bin/bash
  '';
  group = pkgs.writeTextDir "etc/group" ''
    root:x:0:
    agent:x:${toString uid}:
  '';
  nsswitch = pkgs.writeTextDir "etc/nsswitch.conf" ''
    passwd: files
    group: files
    hosts: files dns
  '';
  fonts = pkgs.makeFontsConf {
    fontDirectories = [
      pkgs.dejavu_fonts
      pkgs.noto-fonts-cjk-sans
      pkgs.noto-fonts-color-emoji
    ];
  };
  claudeSettings = pkgs.writeText "teammate-claude.json" (
    builtins.toJSON { hasCompletedOnboarding = true; }
  );

  entrypoint = pkgs.writeShellApplication {
    name = "teammate-entrypoint";
    runtimeInputs = [ pkgs.coreutils ];
    text = ''
      desktop_runtime=${desktopRuntime}
      browser_profile=${volume}/browser
      display_socket=/tmp/.X11-unix/X1
      bus_command=${lib.escapeShellArg shared.busCommand}
      display_command=${lib.escapeShellArg shared.displayCommand}
      openbox_command=${lib.getExe' pkgs.openbox "openbox"}
      sound_command=${lib.escapeShellArg shared.soundCommand}
      browser_command=${lib.escapeShellArg (shared.browserCommand "${volume}/browser")}
      boot_command=(${lib.escapeShellArgs bootCommand})
      claude_settings=${claudeSettings}
    ''
    + builtins.readFile ./files/teammate-entrypoint;
  };

  environment = shared.environment // {
    HOME = home;
    USER = "agent";
    SHELL = "${pkgs.bashInteractive}/bin/bash";
    PATH = "${tools}/bin";
    LANG = "C.UTF-8";
    CLAUDE_CONFIG_DIR = "${home}/.claude";
    MUPPET_CREDENTIALS_FILE = "${credentials}/agent.env";
    # The runtime hides this directory from its children with bubblewrap
    # (`startup.ts` `hiding`), as it hides systemd's on a hosted computer.
    CREDENTIALS_DIRECTORY = credentials;
    MUPPET_RESTART_FILE = "${volume}/.restart";
    # Bound read-only into Claude's sandbox; the volume is read-only anyway.
    HARNESSD_STATE_DIRECTORY = provider;
    PULSE_RUNTIME_PATH = "${desktopRuntime}/pulse";
    FONTCONFIG_FILE = "${fonts}";
    SSL_CERT_FILE = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
    GIT_SSL_CAINFO = "${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt";
  };
in
pkgs.dockerTools.streamLayeredImage {
  name = "teammate-runtime";
  tag = "latest";
  contents = [
    passwd
    group
    nsswitch
    pkgs.dockerTools.binSh
    pkgs.dockerTools.usrBinEnv
    pkgs.dockerTools.caCertificates
  ];
  # Mount points exist in the image (the root is read-only). The agent's
  # volumes are owned by its uid, so fresh named volumes are too.
  fakeRootCommands = ''
    mkdir -p .${volume} .${provider} .${credentials} run/teammate-runtime tmp
    chown ${toString uid}:${toString uid} .${volume} .${provider}
    chmod 0700 .${volume} .${provider}
    # Docker gives a --tmpfs the mode (not the owner) of the directory it
    # covers: the entrypoint makes its own 0700 directory in each.
    chmod 1777 tmp run/teammate-runtime
  '';
  config = {
    User = "${toString uid}:${toString uid}";
    WorkingDir = volume;
    Entrypoint = [
      (lib.getExe pkgs.tini)
      "--"
      (lib.getExe entrypoint)
    ];
    Env = lib.mapAttrsToList (name: value: "${name}=${value}") environment;
    Labels."org.opencontainers.image.title" = "Macro teammate runtime";
  };
  passthru = {
    inherit shared environment;
  };
}
