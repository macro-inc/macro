# Flake-parts module: dockerTools images.
#
# Helpers live under `nix/_containers/` (import-tree ignores `/_` paths).
# Linux dockerTools derivations are also exposed on Darwin (targeting the
# matching GNU/Linux system) so `just run_local` can load images without a
# Dockerfile, given a Linux remote builder.
{ inputs, ... }:
{
  perSystem =
    { pkgs, config, ... }:
    let
      inherit (pkgs) lib;
      linuxSystem =
        if pkgs.stdenv.hostPlatform.isAarch64 then "aarch64-linux" else "x86_64-linux";
      linuxPkgs =
        if pkgs.stdenv.isLinux then
          pkgs
        else
          import inputs.nixpkgs { system = linuxSystem; };

      runtime = linuxPkgs.callPackage ./_containers/runtime.nix { };
      aux = linuxPkgs.callPackage ./_containers/aux.nix { };
      sandbox = linuxPkgs.callPackage ./_containers/sandbox.nix { };
      transcription = linuxPkgs.callPackage ./_containers/transcription.nix { };

      # Baked service images need crane packages from this system. Those
      # packages are Linux-only deploy artifacts (CI).
      serviceImages = lib.optionalAttrs pkgs.stdenv.isLinux (
        pkgs.callPackage ./_containers/service-images.nix {
          inherit runtime;
          deployPackages = config.packages;
        }
      );
    in
    {
      packages = {
        docker-image-local-runtime = runtime.image;
        stream-docker-image-local-runtime = runtime.stream;
        docker-image-local-node-bun = aux.docker-image-local-node-bun;
        stream-docker-image-local-node-bun = aux.stream-docker-image-local-node-bun;
        docker-image-sdk-webhook-relay = aux.docker-image-sdk-webhook-relay;
        stream-docker-image-sdk-webhook-relay = aux.stream-docker-image-sdk-webhook-relay;
        docker-image-agent-harness-sandbox = sandbox.docker-image-agent-harness-sandbox;
        docker-image-coding-agent-sandbox = sandbox.docker-image-coding-agent-sandbox;
        docker-image-transcription = transcription.docker-image-transcription;
      }
      // serviceImages;
    };
}
