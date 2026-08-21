# Flake-parts module: Arion local-stack composition.
#
# The composition itself lives under `nix/_arion/` (import-tree ignores `/_`).
# Image tags come from the same Linux dockerTools attrsets `docker-images.nix`
# exposes — Arion never names a registry image.
{ inputs, ... }:
{
  perSystem =
    { pkgs, system, ... }:
    let
      inherit (pkgs) lib;
      linuxSystem = if pkgs.stdenv.hostPlatform.isAarch64 then "aarch64-linux" else "x86_64-linux";
      linuxPkgs =
        if pkgs.stdenv.isLinux then
          pkgs
        else
          import inputs.nixpkgs { system = linuxSystem; };

      images = builtins.removeAttrs (linuxPkgs.callPackage ./_containers/local-stack.nix { }) [
        "override"
        "overrideDerivation"
      ];
      runtime = linuxPkgs.callPackage ./_containers/runtime.nix { };
      aux = linuxPkgs.callPackage ./_containers/aux.nix { };

      eval = inputs.arion.lib.eval {
        inherit pkgs;
        modules = [
          {
            _module.args = {
              inherit images runtime aux;
            };
          }
          ./_arion
        ];
      };
    in
    {
      packages = {
        arion-compose-yaml = eval.config.out.dockerComposeYaml;
      }
      // lib.optionalAttrs pkgs.stdenv.isLinux {
        arion = inputs.arion.packages.${system}.default;
      };
    };
}
