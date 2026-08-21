# Shared nixpkgs instance for flake-parts modules.
#
# Other `nix/*.nix` modules can take `{ pkgs, ... }` instead of importing
# nixpkgs themselves. `cloud-storage.nix` keeps a local `pkgs` binding so this
# is additive, not a rewrite of that file.
{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    {
      _module.args.pkgs = import inputs.nixpkgs { inherit system; };
    };
}
