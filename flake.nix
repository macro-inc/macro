{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
  };
  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      fenix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          system = system;
        };
        packages = with pkgs; [
          parallel
          docker-compose
          cargo-info
          cargo-udeps
          cargo-lambda
          cargo-deny
          cargo-nextest
          pkg-config
          just
          just-lsp
          taplo
          bun
          pnpm
          sqlx-cli
          typescript-language-server
          nodejs_24
          pulumi
          pulumiPackages.pulumi-nodejs
          biome
          jq
          stripe-cli
          (
            with fenix.packages.${system};
            combine [
              complete.rustc
              complete.rust-src
              complete.cargo
              complete.clippy
              complete.rustfmt
              complete.rust-analyzer
            ]
          )
        ];
        libraries = with pkgs; [
          openssl
          glib
          glibc.dev
          libclang
          gcc
        ];
      in
      {
        devShell = pkgs.mkShell {
          buildInputs = packages ++ libraries;
          LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
          PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
          BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
        };
      }
    );
}
