# Flake outputs for the Macro computer image; see AGENTS.md.
{ inputs, ... }:
{
  perSystem =
    { system, self', lib, ... }:
    let
      pkgs = import inputs.nixpkgs {
        inherit system;
        # Claude Code is unfree.
        config.allowUnfree = true;
      };
      box = import ./_build.nix {
        inherit pkgs;
        inherit (self'.packages) macrod;
      };
    in
    {
      packages = lib.optionalAttrs (system == "x86_64-linux") {
        macro-box-rootfs = box.rootfs;
        macro-box-incus = box.incus;
        macro-box-docker = box.docker;
      };
    };
}
