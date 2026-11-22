# Pin Claude Code's upstream native binary (2.1.280 or newer for the models
# computers default to) while retaining nixpkgs' patching and wrapper.
{ pkgs }:
let
  # Upstream's platform name and the binary's hash, from its manifest.
  release =
    {
      x86_64-linux = {
        platform = "linux-x64";
        hash = "sha256-HghQPb3zwssNcG0y80CCdziNHHbvEIZz6P5CwbMikls=";
      };
      # The teammate runtime image only.
      aarch64-linux = {
        platform = "linux-arm64";
        hash = "sha256-kvK0/QXQvc97mg1ODs70oeSzaLKQzY/QfP+aUAE/RaI=";
      };
    }
    .${pkgs.stdenv.hostPlatform.system};
in
pkgs.claude-code.overrideAttrs (finalAttrs: _previous: {
  version = "2.1.280";
  src = pkgs.fetchurl {
    url = "https://downloads.claude.ai/claude-code-releases/${finalAttrs.version}/${release.platform}/claude";
    inherit (release) hash;
  };
})
