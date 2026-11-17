# NixOS hosts. Host modules live under hosts/_nixos (the underscore keeps
# import-tree from loading them as flake-parts modules).
{ inputs, ... }:
{
  flake.nixosConfigurations.runtime-dev-1 = inputs.nixpkgs.lib.nixosSystem {
    system = "x86_64-linux";
    modules = [
      inputs.disko.nixosModules.disko
      ./hosts/_nixos/gcp.nix
      ./hosts/_nixos/incus-host.nix
      ./hosts/_nixos/runtime-dev-1.nix
    ];
  };
}
