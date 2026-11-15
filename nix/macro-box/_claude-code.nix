# Pin Claude Code's upstream native binary (2.1.280 or newer for the models
# computers default to) while retaining nixpkgs' patching and wrapper.
{ pkgs }:
pkgs.claude-code.overrideAttrs (finalAttrs: _previous: {
  version = "2.1.280";
  src = pkgs.fetchurl {
    url = "https://downloads.claude.ai/claude-code-releases/${finalAttrs.version}/linux-x64/claude";
    hash = "sha256-HghQPb3zwssNcG0y80CCdziNHHbvEIZz6P5CwbMikls=";
  };
})
