# NixOS hosts. Host modules live under hosts/_nixos (the underscore keeps
# import-tree from loading them as flake-parts modules).
_: {
  perSystem =
    {
      pkgs,
      lib,
      self',
      ...
    }:
    {
      checks = lib.optionalAttrs (pkgs.stdenv.hostPlatform.system == "x86_64-linux") {
        firecracker-host = import ./hosts/_nixos/firecracker-host-test.nix {
          inherit pkgs;
          package = self'.packages.firecracker-host;
          guestAgent = self'.packages.firecracker-guest-agent;
        };
      };
    };
}
