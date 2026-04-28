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
          zip
          cargo-info
          cargo-udeps
          cargo-lambda
          cargo-deny
          cargo-nextest
          cargo-expand
          wasm-pack
          pkg-config
          bacon
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
          sops
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
              targets.wasm32-unknown-unknown.latest.rust-std
            ]
          )
        ];
        libraries =
          with pkgs;
          [
            openssl
            glib
            libclang
          ]
          ++ pkgs.lib.optionals isLinux [
            glibc.dev
            gcc
          ]
          ++ pkgs.lib.optionals isDarwin [
            libiconv
          ];
      in
      {
        devShell = pkgs.mkShell (
          {
            buildInputs = packages ++ libraries;
            PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
            LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
            SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93";
          }
          // pkgs.lib.optionalAttrs isLinux {
            LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
            BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
          }
        );
      }
    );
}
