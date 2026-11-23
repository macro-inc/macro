# The agent's screen as H.264 for a person watching it in Macro: a
# socket-activated encoder on 127.0.0.1:5902, one instance per connection
# (Accept=yes), in the sandbox and /tmp of the agent's desktop. The harness
# reaches it only through the fleet's exec tunnel.
#
# A connection sends one line `<fps> <width> <height> <keyint>\n`; the
# instance then writes fragmented MP4 of display `:1` to it until it closes:
# `ftyp` + `moov` (no samples), then one `moof` + `mdat` per frame.
# Constrained Baseline, no B-frames, so every frame decodes on arrival; a new
# connection starts on a keyframe.
#
# Called by `_agent.nix` with its sandbox and desktop environment; returns the
# encoder script and its units.
{
  pkgs,
  lib,
  sandbox,
  desktopEnvironment,
  ffmpeg,
  port ? 5902,
}:
let
  encoder = pkgs.writeShellApplication {
    name = "agent-screen-encoder";
    runtimeInputs = [ ffmpeg ];
    text = builtins.readFile ./files/agent-screen-encoder;
  };
in
{
  inherit encoder port;

  socket = {
    description = "The agent teammate's screen as fragmented MP4 on 127.0.0.1:${toString port}";
    wantedBy = [ "sockets.target" ];
    socketConfig = {
      ListenStream = "127.0.0.1:${toString port}";
      Accept = true;
      # Each viewer is one x264 encoder.
      MaxConnections = 4;
      NoDelay = true;
      # A burst of connections must not stop the socket for good (the
      # default trigger limit fails it); MaxConnections bounds the work.
      TriggerLimitIntervalSec = 0;
    };
  };

  service = {
    description = "Encode the agent teammate's screen for one viewer";
    requisite = [ "macro-agent-display.service" ];
    after = [ "macro-agent-display.service" ];
    environment = desktopEnvironment;
    unitConfig = {
      # The display's /tmp, which holds :1's socket.
      JoinsNamespaceOf = "macro-agent-display.service";
      # Every viewer is an instance, which a hang-up ends as failed
      # (ffmpeg's write error): unload it either way.
      CollectMode = "inactive-or-failed";
    };
    serviceConfig = sandbox // {
      ExecStart = lib.getExe encoder;
      # ffmpeg needs only the display: none of the agent's home.
      BindPaths = [ ];
      StandardInput = "socket";
      StandardOutput = "socket";
      StandardError = "journal";
      # One instance per connection: it ends with the connection.
      Restart = "no";
      MemoryMax = "1G";
      CPUWeight = 50;
    };
  };
}
