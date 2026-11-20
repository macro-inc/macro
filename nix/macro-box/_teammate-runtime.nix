# The agent teammate's runtime closure, defined once for its two launchers:
# the hosted units (`_agent.nix`) and the teammate runtime image
# (`_teammate-image.nix`). `paths` says where a launcher keeps the agent's
# files and desktop sockets; everything else is the same.
{
  pkgs,
  # node_modules for the starter agent (`_agent-runtime.nix`).
  runtime,
  # computer-use-linux (`_computer-use-linux.nix`).
  computerUse,
  # The pinned Claude Code behind the `claude` wrapper (`_claude-code.nix`).
  claudeCode,
  paths,
}:
let
  inherit (pkgs) lib;
  inherit (paths)
    workspace
    lastGood
    failures
    bootHead
    desktopRuntime
    displayNumber
    ;

  # 9222 is macro's Chromium on :0 of a hosted computer.
  cdpPort = 9223;
  browserCdpUrl = "http://127.0.0.1:${toString cdpPort}";
  display = ":${toString displayNumber}";
  vncPort = 5900 + displayNumber;
  busAddress = "unix:path=${desktopRuntime}/bus";
  pulseServer = "unix:${desktopRuntime}/pulse/native";

  # nixpkgs' Bun 1.3.13 times out in Playwright's connectOverCDP, which the
  # agent's browser capability and its checks use; 1.4.2 connects. Drop this
  # once nixpkgs ships >= 1.4.2.
  bunRelease =
    {
      x86_64-linux = {
        url = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-x64.zip";
        hash = "sha256-NjaPrvdSeHXV/6UuU81IAhdB8qg+tiCKjdZAaNQiqRM=";
      };
      aarch64-linux = {
        url = "https://github.com/oven-sh/bun/releases/download/bun-v1.4.2/bun-linux-aarch64.zip";
        hash = "sha256-VDKLvC2cjgyfiSxUTWbFeoO4QTnjSQnl7oF1jxrI/ac=";
      };
    }
    .${pkgs.stdenv.hostPlatform.system};
  bun =
    assert lib.assertMsg (lib.versionOlder pkgs.bun.version "1.4.2")
      "nixpkgs ships Bun ${pkgs.bun.version}; drop the agent's Bun override";
    pkgs.bun.overrideAttrs {
      version = "1.4.2";
      src = pkgs.fetchurl bunRelease;
    };

  ffmpegX11grab = pkgs.runCommand "ffmpeg-x11grab" { } ''
    mkdir -p $out/bin
    ln -s ${pkgs.ffmpeg-full}/bin/ffmpeg $out/bin/ffmpeg-x11grab
  '';
  # What the runtime runs by name (calls share :1 through ffmpeg-x11grab and
  # record the default sink with parec). `claude` comes from the launcher:
  # the system profile on a hosted computer, `claude` below in the image.
  runtimePath = [
    bun
    pkgs.git
    pkgs.coreutils
    pkgs.chromium
    pkgs.pulseaudio
    pkgs.ffmpeg-headless
    ffmpegX11grab
    # Secrets put a value on :1's clipboard.
    pkgs.xclip
    # For the runtime to run capability scripts and Claude's tools with the
    # credentials directory masked (`bwrap --tmpfs /run/credentials`).
    pkgs.bubblewrap
  ];
  scriptVariables = ''
    workspace=${workspace}
    last_good=${lastGood}
    failures=${failures}
    boot_head=${bootHead}
    max_failed_boots=3
    runtime=${runtime}
    helper=${lib.getExe credentialHelper}
    helper_credentials=${paths.helperCredentials}
  ''
  # The computer's setup trace macrod staged (start-agent joins it once);
  # only a hosted computer has one.
  + lib.optionalString (paths ? setupTraceparent) ''
    setup_traceparent=${paths.setupTraceparent}
    setup_traceparent_used=${paths.setupTraceparentUsed}
  '';
  credentialHelper = pkgs.writeShellApplication {
    name = "git-credential-agent";
    runtimeInputs = [
      pkgs.gnused
      pkgs.coreutils
    ];
    text = builtins.readFile ./files/agent-env-setting + builtins.readFile ./files/git-credential-agent;
  };
  startAgent = pkgs.writeShellApplication {
    name = "start-agent";
    runtimeInputs = runtimePath ++ [
      pkgs.gnused
      pkgs.diffutils
    ];
    text =
      scriptVariables
      + builtins.readFile ./files/agent-env-setting
      + builtins.readFile ./files/start-agent;
  };
  agentStopped = pkgs.writeShellApplication {
    name = "agent-stopped";
    runtimeInputs = [ pkgs.coreutils ];
    # It uses only some of the shared variables.
    excludeShellChecks = [ "SC2034" ];
    text = scriptVariables + builtins.readFile ./files/agent-stopped;
  };

  # GNOME's interface settings with toolkit-accessibility on by default:
  # computer-use-linux reads Chromium's AT-SPI tree only when that key, or
  # the AT-SPI bus's IsEnabled (which the bus launcher derives from it), says
  # accessibility is on. There is no dconf, so the default is the value.
  accessibilitySettings = pkgs.runCommand "agent-accessibility-settings" { nativeBuildInputs = [ pkgs.glib ]; } ''
    mkdir -p $out
    cp ${pkgs.glib.getSchemaPath pkgs.gsettings-desktop-schemas}/*.xml $out/
    printf '[org.gnome.desktop.interface]\ntoolkit-accessibility=true\n' > $out/90_macro-agent.gschema.override
    glib-compile-schemas --strict $out
  '';

  # What every process on the agent's desktop sees.
  desktopEnvironment = {
    DISPLAY = display;
    XDG_RUNTIME_DIR = desktopRuntime;
    DBUS_SESSION_BUS_ADDRESS = busAddress;
    PULSE_SERVER = pulseServer;
    GSETTINGS_SCHEMA_DIR = accessibilitySettings;
    # Chromium and GTK expose AT-SPI trees for computer use.
    ACCESSIBILITY_ENABLED = "1";
  };

  # Stdio MCP servers the runtime adds to its Claude Code query.
  mcpServers = {
    computer-use-linux = {
      type = "stdio";
      command = lib.getExe computerUse;
      args = [ "mcp" ];
      env = desktopEnvironment // {
        # The agent's desktop is plain X11 under Openbox.
        COMPUTER_USE_LINUX_SCREENSHOT_BACKEND = "x11";
      };
    };
  };

  # The agent's session bus: AT-SPI is activated on it, and nothing else
  # (macro's has systemd's user manager).
  busConfig = pkgs.writeText "macro-agent-bus.conf" ''
    <!DOCTYPE busconfig PUBLIC "-//freedesktop//DTD D-BUS Bus Configuration 1.0//EN"
     "http://www.freedesktop.org/standards/dbus/1.0/busconfig.dtd">
    <busconfig>
      <type>session</type>
      <listen>${busAddress}</listen>
      <auth>EXTERNAL</auth>
      <servicedir>${pkgs.at-spi2-core}/share/dbus-1/services</servicedir>
      <policy context="default">
        <allow send_destination="*" eavesdrop="true"/>
        <allow eavesdrop="true"/>
        <allow own="*"/>
      </policy>
    </busconfig>
  '';
  # The agent's sound server: one null sink `agent`, the default, whose
  # monitor a call records; there is no sound card.
  soundConfig = pkgs.writeText "macro-agent-sound.pa" ''
    load-module module-native-protocol-unix socket=${desktopRuntime}/pulse/native auth-anonymous=1
    load-module module-null-sink sink_name=agent sink_properties=device.description=Agent
    set-default-sink agent
  '';

  # The agent's display: VNC on loopback only, and only :1's filesystem
  # socket (no TCP, no abstract socket).
  displayCommand = "${pkgs.tigervnc}/bin/Xvnc ${display} -geometry 1920x1080 -depth 24 -rfbport ${toString vncPort} -interface 127.0.0.1 -localhost -SecurityTypes None -UseBlacklist 0 -AlwaysShared -nolisten tcp -nolisten local";
  # The agent's browser on its display (so a screen share shows it), with
  # DevTools on loopback only and AT-SPI on for computer use.
  browserCommand =
    profile:
    lib.concatStringsSep " " [
      (lib.getExe pkgs.chromium)
      "--user-data-dir=${profile}"
      "--remote-debugging-address=127.0.0.1"
      "--remote-debugging-port=${toString cdpPort}"
      "--force-renderer-accessibility"
      "--no-first-run"
      "--no-default-browser-check"
      "--disable-dev-shm-usage"
      "--password-store=basic"
      "--start-maximized"
    ];
  soundCommand = "${lib.getExe' pkgs.pulseaudio "pulseaudio"} --daemonize=no --exit-idle-time=-1 --log-target=stderr -n --file=${soundConfig}";
  busCommand = "${lib.getExe' pkgs.dbus "dbus-daemon"} --nofork --nopidfile --config-file=${busConfig}";

  # `claude` reading this launcher's provider sign-in.
  claude = import ./_claude-wrapper.nix {
    inherit pkgs claudeCode;
    credential = paths.claudeCredential;
  };

  # The runtime's own environment, beside the desktop's.
  environment = desktopEnvironment // {
    AGENT_SHELL = "1";
    AGENT_WORKSPACE = workspace;
    MUPPET_LAST_GOOD_FILE = lastGood;
    MUPPET_MCP_SERVERS_JSON = builtins.toJSON mcpServers;
    # The agent's Chromium on its desktop, for muppet's browser utility.
    MUPPET_BROWSER_CDP_URL = browserCdpUrl;
    LIVEKIT_FFMPEG_PATH = lib.getExe pkgs.ffmpeg-headless;
    # LiveKit's native modules link libstdc++.
    LD_LIBRARY_PATH = "${pkgs.stdenv.cc.cc.lib}/lib";
  };
in
{
  inherit
    bun
    runtimePath
    credentialHelper
    startAgent
    agentStopped
    accessibilitySettings
    desktopEnvironment
    environment
    mcpServers
    claude
    display
    vncPort
    cdpPort
    browserCdpUrl
    displayCommand
    browserCommand
    soundCommand
    busCommand
    ;
}
