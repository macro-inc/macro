# The brain's configured model requires Claude Code 2.1.280 or newer.
# Pin its upstream native binary while retaining nixpkgs' patching and wrapper.
{ pkgs }:
pkgs.claude-code.overrideAttrs (finalAttrs: _previous: {
  version = "2.1.280";
  src = pkgs.fetchurl {
    url = "https://downloads.claude.ai/claude-code-releases/${finalAttrs.version}/linux-x64/claude";
    hash = "sha256-HghQPb3zwssNcG0y80CCdziNHHbvEIZz6P5CwbMikls=";
  };
})
