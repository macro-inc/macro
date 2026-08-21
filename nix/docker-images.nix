# Flake-parts module: dockerTools images.
#
# Helpers live under `nix/_containers/` (import-tree ignores `/_` paths).
{ ... }:
{
  perSystem =
    { pkgs, config, ... }:
    let
      inherit (pkgs) lib;
      runtime = pkgs.callPackage ./_containers/runtime.nix { };
      serviceImages = pkgs.callPackage ./_containers/service-images.nix {
        inherit runtime;
        deployPackages = config.packages;
      };
    in
    {
      packages = lib.optionalAttrs pkgs.stdenv.isLinux (
        {
          docker-image-local-runtime = runtime.image;
          stream-docker-image-local-runtime = runtime.stream;
        }
        // serviceImages
      );
    };
}
