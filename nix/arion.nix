# Flake-parts module: Arion local-stack composition.
#
# The composition itself lives under `nix/_arion/` (import-tree ignores `/_`).
{ inputs, ... }:
{
  perSystem =
    { pkgs, system, ... }:
    let
      inherit (pkgs) lib;
      eval = inputs.arion.lib.eval {
        inherit pkgs;
        modules = [ ./_arion ];
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
