# The `claude` on PATH: the pinned Claude Code behind files/claude-wrapper,
# which picks the session's credential from harnessd's credential file.
{
  pkgs,
  claudeCode,
  credential,
}:
pkgs.writeShellApplication {
  name = "claude";
  text =
    builtins.replaceStrings
      [ "@credential@" "@jq@" "@claude@" ]
      [
        (pkgs.lib.escapeShellArg credential)
        (pkgs.lib.getExe pkgs.jq)
        (pkgs.lib.getExe' claudeCode "claude")
      ]
      (builtins.readFile ./files/claude-wrapper);
}
