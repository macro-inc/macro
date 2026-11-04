{
  description = "Macro observability EC2 image";
  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-26.05";

  outputs =
    { nixpkgs, ... }:
    let
      system = "x86_64-linux";
      host = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          "${nixpkgs}/nixos/maintainers/scripts/ec2/amazon-image.nix"
          ./nixos/host.nix
        ];
      };
      databaseCollector = nixpkgs.lib.nixosSystem {
        inherit system;
        modules = [
          "${nixpkgs}/nixos/maintainers/scripts/ec2/amazon-image.nix"
          ./nixos/database-collector/host.nix
        ];
      };
    in
    {
      nixosConfigurations.observability = host;
      nixosConfigurations.database-collector = databaseCollector;
      packages.${system} = {
        default = host.config.system.build.amazonImage;
        database-collector = databaseCollector.config.system.build.amazonImage;
      };
      formatter.${system} = nixpkgs.legacyPackages.${system}.nixfmt;
    };
}
