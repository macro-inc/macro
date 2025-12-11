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
        isDarwin = pkgs.stdenv.isDarwin;
        isLinux = pkgs.stdenv.isLinux;
        packages = with pkgs; [
          parallel
          docker-compose
          cargo-info
          cargo-udeps
          cargo-lambda
          cargo-deny
          cargo-nextest
          bacon
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
          libclang
        ] ++ pkgs.lib.optionals isLinux [
          glibc.dev
          gcc
        ] ++ pkgs.lib.optionals isDarwin [
          libiconv
        ];
      in
      {
        devShell = pkgs.mkShell ({
          buildInputs = packages ++ libraries;
          PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
        } // pkgs.lib.optionalAttrs isLinux {
          LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
          BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
        });
      }
    );
}
