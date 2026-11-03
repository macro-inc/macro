# infra/platform as flake outputs: `platform` (instance and cluster renderers)
# for x86_64-linux, the system the cluster nodes run.
{ inputs, ... }:
let
  system = "x86_64-linux";
  pkgs = import inputs.nixpkgs { inherit system; };
in
{
  flake.platform = import ../infra/platform {
    inherit pkgs;
    inherit (inputs) kubenix nix-snapshotter;
  };
}
