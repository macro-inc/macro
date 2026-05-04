{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
    crane.url = "github:ipetkov/crane";
    rs-libreoffice-bindings.url = "github:macro-inc/rs-libreoffice-bindings/dev";
    rs-libreoffice-bindings.flake = false;
  };
  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      fenix,
      crane,
      rs-libreoffice-bindings,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          system = system;
        };
        isDarwin = pkgs.stdenv.isDarwin;
        isLinux = pkgs.stdenv.isLinux;

        rustToolchain = fenix.packages.${system}.fromToolchainFile {
          file = ./rust/rust-toolchain.toml;
          sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
        };

        craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

        libraries =
          with pkgs;
          [
            openssl
            openssl.dev
            glib
            glib.dev
            libclang
          ]
          ++ pkgs.lib.optionals isLinux [
            glibc.dev
            gcc
          ]
          ++ pkgs.lib.optionals isDarwin [
            libiconv
          ];

        # Include Cargo sources plus the .sqlx offline query cache.
        # rs-libreoffice-bindings lives outside the repo; we import it explicitly
        # so the nix sandbox can resolve the path dep in convert_service.
        src =
          let
            sqlxFilter = path: _type: builtins.match ".*\\.sqlx/.*\\.json$" path != null;
            pdfiumFilter = path: _type: builtins.match ".*pdfium-lib/.*\\.(so|dylib)$" path != null;
            assetFilter = path: _type: builtins.match ".*\\.(md|html|txt|json|canvas)$" path != null;
            srcFilter = path: type: (sqlxFilter path type) || (pdfiumFilter path type) || (assetFilter path type) || (craneLib.filterCargoSources path type);
            cloudStorageSrc = pkgs.lib.cleanSourceWith {
              src = ./rust/cloud-storage;
              filter = srcFilter;
            };
            cSourceFilter = path: _type: builtins.match ".*\\.(c|h)$" path != null;
            libreofficeBindingsSrc = pkgs.lib.cleanSourceWith {
              src = rs-libreoffice-bindings;
              filter = path: type: (cSourceFilter path type) || (craneLib.filterCargoSources path type);
            };
          in
          pkgs.runCommand "cloud-storage-src" { } ''
            cp -rT ${cloudStorageSrc} $out
            chmod -R +w $out
            cp -rT ${libreofficeBindingsSrc} $out/rs-libreoffice-bindings
          '';

        commonArgs =
          {
            inherit src;
            pname = "cloud-storage";
            version = "0.1.0";
            strictDeps = true;
            buildInputs = libraries;
            nativeBuildInputs = with pkgs; [ pkg-config ] ++ pkgs.lib.optionals isLinux [ mold ];
            LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
            OPENSSL_NO_VENDOR = "1";
            SQLX_OFFLINE = "true";
            RUSTFLAGS = "-Dwarnings" + pkgs.lib.optionalString isLinux " -C link-arg=-fuse-ld=mold";
            RUSTDOCFLAGS = "-Dwarnings";
          }
          // pkgs.lib.optionalAttrs isLinux {
            LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
            BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
          };

        # Pre-built deps — this derivation is what Cachix caches to skip dep recompilation
        cargoArtifacts = craneLib.buildDepsOnly commonArgs;

        openApiBins = craneLib.buildPackage (
          commonArgs
          // {
            inherit cargoArtifacts;
            pname = "cloud-storage-openapi";
            doCheck = false;
            cargoBuildCommand = "cargo build";
            cargoExtraArgs = pkgs.lib.concatStringsSep " " [
              "--bin document_storage_service_openapi"
              "--bin comms_service_openapi"
              "--bin properties_service_openapi"
              "--bin document_cognition_service_openapi"
              "--bin authentication_service_openapi"
              "--bin notification_service_openapi"
              "--bin static_file_service_openapi"
              "--bin connection_gateway_openapi"
              "--bin contacts_service_openapi"
              "--bin unfurl_service_openapi"
              "--bin email_service_openapi"
              "--bin search_service_openapi"
              "--bin scheduled_action_openapi"
              "--bin document_cognition_service_models"
              "--bin gen_tool_schemas"
            ];
          }
        );

        shellTools = with pkgs; [
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
          rustToolchain
        ];
      in
      {
        checks = {
          fmt = craneLib.cargoFmt {
            inherit src;
            pname = "cloud-storage";
            version = "0.1.0";
          };
          clippy = craneLib.cargoClippy (
            commonArgs
            // {
              inherit cargoArtifacts;
              cargoClippyExtraArgs = "--all-features -- -D warnings";
            }
          );
          gen-api =
            let
              openApiFiles = pkgs.lib.cleanSourceWith {
                src = ./js/app/packages/service-clients;
                filter = path: type:
                  type == "directory" || pkgs.lib.hasSuffix "openapi.json" (baseNameOf path);
              };
              crateToDir = {
                document_storage_service = "service-storage";
                comms_service = "service-comms";
                properties_service = "service-properties";
                document_cognition_service = "service-cognition";
                authentication_service = "service-auth";
                notification_service = "service-notification";
                static_file_service = "service-static-files";
                connection_gateway = "service-connection";
                contacts_service = "service-contacts";
                unfurl_service = "service-unfurl";
                email_service = "service-email";
                search_service = "service-search";
                scheduled_action = "service-scheduled-action";
              };
              checkScript = pkgs.lib.concatStringsSep "\n" (
                pkgs.lib.mapAttrsToList (crate: dir: ''
                  echo -n "Checking ${dir}/openapi.json ... "
                  if ! diff \
                    <("${openApiBins}/bin/${crate}_openapi" | ${pkgs.jq}/bin/jq --sort-keys .) \
                    <(${pkgs.jq}/bin/jq --sort-keys . < "${openApiFiles}/${dir}/openapi.json"); then
                    echo "FAIL: run 'bun run gen-api' and commit the result"
                    exit 1
                  fi
                  echo "ok"
                '') crateToDir
              );
            in
            pkgs.runCommand "cloud-storage-gen-api-check" { RUST_LOG = "error"; } ''
              ${checkScript}
              touch $out
            '';
        };

        packages = {
          inherit cargoArtifacts openApiBins;
          default = cargoArtifacts;
        };

        devShell = pkgs.mkShell (
          {
            buildInputs = shellTools ++ libraries;
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
