{
  description = "muppet credentials: the programs sopsCredentials needs";

  # What utilities/credentials needs on the system: sops, and age for its keys.
  # An agent's flake takes this as an input and adds it to its dev shell:
  #
  #   inputs.credentials = {
  #     url = "github:<owner>/muppet?dir=packages/lib/utilities/credentials";
  #     inputs.nixpkgs.follows = "nixpkgs";
  #   };
  #
  #   devShells.default = pkgs.mkShell {
  #     packages = [ credentials.packages.${system}.default ];
  #   };

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
    in
    {
      packages = forAllSystems (pkgs: {
        default = pkgs.buildEnv {
          name = "muppet-credentials";
          paths = [
            pkgs.sops
            pkgs.age
          ];
        };
      });
    };
}
