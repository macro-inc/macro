{
  description = "muppet";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # Each utility that needs programs has a flake of its own; muppet uses
    # them the way an agent would, so they're tested here.
    credentials = {
      url = "path:./packages/lib/utilities/credentials";
      inputs.nixpkgs.follows = "nixpkgs";
    };
    browser = {
      url = "path:./packages/lib/utilities/browser";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    {
      nixpkgs,
      credentials,
      browser,
      ...
    }:
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
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.bun
            # Editors like Zed run the TypeScript language server with this node.
            pkgs.nodejs
            credentials.packages.${pkgs.stdenv.hostPlatform.system}.default
            browser.packages.${pkgs.stdenv.hostPlatform.system}.default
          ];

          # The glibc Biome binary from npm can't run on NixOS; use the static musl build instead.
          env = pkgs.lib.optionalAttrs pkgs.stdenv.hostPlatform.isLinux {
            BIOME_BINARY = "@biomejs/cli-linux-${
              if pkgs.stdenv.hostPlatform.isAarch64 then "arm64" else "x64"
            }-musl/biome";
          };
        };
      });

      formatter = forAllSystems (pkgs: pkgs.nixfmt-rfc-style);
    };
}
