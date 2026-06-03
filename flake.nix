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

        # ── cloud-storage (Rust backend) ──────────────────────────────

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
            assetFilter = path: _type: builtins.match ".*\\.(md|html|txt|json|canvas|sql)$" path != null;
            srcFilter =
              path: type:
              (sqlxFilter path type)
              || (pdfiumFilter path type)
              || (assetFilter path type)
              || (craneLib.filterCargoSources path type);
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

        commonArgs = {
          inherit src;
          pname = "cloud-storage";
          version = "0.1.0";
          strictDeps = true;
          buildInputs = libraries;
          nativeBuildInputs = with pkgs; [ pkg-config ] ++ pkgs.lib.optionals isLinux [ mold ];
          LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
          OPENSSL_NO_VENDOR = "1";
          SQLX_OFFLINE = "true";
          RUSTFLAGS = pkgs.lib.optionalString isLinux "-C link-arg=-fuse-ld=mold";
          # Build deps + workspace + bins in dev profile so the test job (which runs
          # `cargo nextest` outside the sandbox using the test profile, inheriting dev)
          # can reuse the restored target/debug/ instead of recompiling all deps.
          CARGO_PROFILE = "dev";
        }
        // pkgs.lib.optionalAttrs isLinux {
          LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
          BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
        };

        # Pre-built third-party deps — Cachix caches this; hash is driven by Cargo.lock
        # (workspace member sources are stubbed by crane), so it survives most PRs.
        # --all-features matches the test job (cargo nextest --all-features) and clippy
        # so all consumers share the same dep feature unification.
        cargoArtifacts = craneLib.buildDepsOnly (
          commonArgs
          // {
            cargoExtraArgs = "--locked --all-features";
          }
        );

        # Layered atop cargoArtifacts: pre-compile every workspace lib crate so
        # downstream derivations (openApiBins, clippy) inherit a warm target/. The
        # hash is per-source so cachix only hits when the SHA matches across CI
        # workflows — but since code-check-cloud-storage and web-app-check-main both
        # run on the same SHA, whichever finishes first pushes for the other.
        workspaceArtifacts = craneLib.cargoBuild (
          commonArgs
          // {
            inherit cargoArtifacts;
            pname = "cloud-storage-workspace";
            doCheck = false;
            doInstallCargoArtifacts = true;
            cargoExtraArgs = "--locked --all-features --workspace --lib";
            RUSTFLAGS = "-Dwarnings" + pkgs.lib.optionalString isLinux " -C link-arg=-fuse-ld=mold";
            RUSTDOCFLAGS = "-Dwarnings";
          }
        );

        openApiBins = craneLib.buildPackage (
          commonArgs
          // {
            cargoArtifacts = workspaceArtifacts;
            pname = "cloud-storage-openapi";
            doCheck = false;
            cargoExtraArgs = pkgs.lib.concatStringsSep " " [
              "--locked"
              "--all-features"
              "--bin document_storage_service_openapi"
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

        # Pre-built nextest archive — packages all compiled test binaries plus their
        # metadata into a single tar.zst. CI fetches this archive and runs
        # `cargo nextest run --archive-file` outside the sandbox so tests can hit
        # postgres/redis services. Built in nix → cached by cachix.
        nextestArchive = craneLib.mkCargoDerivation (
          commonArgs
          // {
            cargoArtifacts = workspaceArtifacts;
            pname = "cloud-storage-nextest-archive";
            doCheck = false;
            nativeBuildInputs = commonArgs.nativeBuildInputs or [ ] ++ [ pkgs.cargo-nextest ];
            buildPhaseCargoCommand = ''
              cargo nextest archive \
                --cargo-profile dev \
                --locked --all-features \
                --workspace --lib --bins --tests \
                --archive-file nextest-archive.tar.zst
            '';
            installPhaseCommand = ''
              mkdir -p $out
              cp nextest-archive.tar.zst $out/
            '';
          }
        );

        deployCargoArtifacts = craneLib.buildDepsOnly (
          commonArgs
          // {
            pname = "cloud-storage-deploy-deps";
            cargoExtraArgs = "--locked";
            CARGO_PROFILE = "release";
          }
        );

        deployServiceBinaryPackage =
          serviceName: binaries:
          craneLib.buildPackage (
            commonArgs
            // {
              cargoArtifacts = deployCargoArtifacts;
              pname = "cloud-storage-${serviceName}-binaries";
              doCheck = false;
              cargoExtraArgs =
                "--locked " + pkgs.lib.concatMapStringsSep " " (binary: "--bin ${binary}") binaries;
              CARGO_PROFILE = "release";
              installPhaseCommand = ''
                mkdir -p $out/bin
                for binary in ${pkgs.lib.concatStringsSep " " binaries}; do
                  cp target/release/$binary $out/bin/$binary
                  ${pkgs.binutils}/bin/strip $out/bin/$binary || true
                done
              '';
            }
          );

        deployServiceBinaryPackages = {
          deploy-service-binaries-agent-schedule-service =
            deployServiceBinaryPackage "agent-schedule-service"
              [ "service" ];
          deploy-service-binaries-authentication-service =
            deployServiceBinaryPackage "authentication-service"
              [ "authentication_service" ];
          deploy-service-binaries-connection-gateway = deployServiceBinaryPackage "connection-gateway" [
            "connection_gateway_service"
          ];
          deploy-service-binaries-contacts-service = deployServiceBinaryPackage "contacts-service" [
            "contacts_service"
          ];
          deploy-service-binaries-convert-service = deployServiceBinaryPackage "convert-service" [
            "convert_service"
          ];
          deploy-service-binaries-document-cognition-service =
            deployServiceBinaryPackage "document-cognition-service"
              [ "document_cognition_service" ];
          deploy-service-binaries-document-storage-service =
            deployServiceBinaryPackage "document-storage-service"
              [ "document_storage_service" ];
          deploy-service-binaries-email-service = deployServiceBinaryPackage "email-service" [
            "email_service"
            "pubsub_workers"
          ];
          deploy-service-binaries-image-proxy-service = deployServiceBinaryPackage "image-proxy-service" [
            "image_proxy_service"
          ];
          deploy-service-binaries-mcp-server = deployServiceBinaryPackage "mcp-server" [ "mcp_service" ];
          deploy-service-binaries-notification-service = deployServiceBinaryPackage "notification-service" [
            "notification_service"
          ];
          deploy-service-binaries-search-processing-service =
            deployServiceBinaryPackage "search-processing-service"
              [ "search_processing_service" ];
          deploy-service-binaries-static-file-service = deployServiceBinaryPackage "static-file-service" [
            "static_file_service"
          ];
          deploy-service-binaries-unfurl-service = deployServiceBinaryPackage "unfurl-service" [
            "unfurl_service"
          ];
        };

        shellTools =
          with pkgs;
          [
            parallel
            docker-compose
            zip
            cargo-info
            cargo-udeps
            cargo-lambda
            (writeShellScriptBin "rustup" ''
              set -euo pipefail
              rustc_path="$(${coreutils}/bin/readlink -f "$(command -v rustc)")"
              toolchain="$(${coreutils}/bin/basename "$(${coreutils}/bin/dirname "$(${coreutils}/bin/dirname "$rustc_path")")")"
              case "$1 $2" in
                "toolchain list") echo "$toolchain (default)" ;;
                "toolchain add") exit 0 ;;
                "target list") echo "x86_64-unknown-linux-gnu (installed)"; echo "aarch64-unknown-linux-gnu"; echo "wasm32-unknown-unknown (installed)" ;;
                "target add") exit 0 ;;
                "component list") echo "rust-src-x86_64-unknown-linux-gnu (installed)"; echo "clippy-x86_64-unknown-linux-gnu (installed)" ;;
                "component add") exit 0 ;;
                *) echo "rustup shim only supports commands used by cross" >&2; exit 1 ;;
              esac
            '')
            cargo-cross
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
            sccache
            rustToolchain
          ]
          ++ pkgs.lib.optionals isLinux [ mold ];

        # ── js-app (frontend Tauri app) ────────────────────────────────

        # Need allowUnfree + android license for the Android SDK
        jsPkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
          config.android_sdk.accept_license = true;
        };

        android_sdk = pkgs.lib.optionalAttrs isLinux (
          (jsPkgs.androidenv.composeAndroidPackages {
            platformVersions = [
              "34"
              "36"
            ];
            buildToolsVersions = [
              "35.0.0"
            ];
            ndkVersions = [ "26.3.11579264" ];
            includeNDK = true;
            useGoogleAPIs = false;
            useGoogleTVAddOns = false;
            includeEmulator = true;
            includeSystemImages = true;
            systemImageTypes = [ "google_apis_playstore" ];
            abiVersions = [ "x86_64" ];
            includeSources = false;
          }).androidsdk
        );

        jsBasePackages = with jsPkgs; [
          curl
          wget
          pkg-config
          just
          bun
          biome
          nodejs_24
          typescript-language-server
          cargo-tauri
          cargo-info
          cargo-udeps
          pulumi
          pulumiPackages.pulumi-nodejs
          pulumiPackages.pulumi-aws-native
          playwright
          playwright-mcp
          (
            with fenix.packages.${system};
            combine (
              [
                complete.rustc
                complete.rust-src
                complete.cargo
                complete.clippy
                complete.rustfmt
                complete.rust-analyzer
              ]
              ++ pkgs.lib.optionals isLinux [
                targets.aarch64-linux-android.latest.rust-std
                targets.armv7-linux-androideabi.latest.rust-std
                targets.i686-linux-android.latest.rust-std
                targets.x86_64-linux-android.latest.rust-std
              ]
            )
          )
        ];

        jsLinuxPackages = with jsPkgs; [
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad
          jdk
          xdg-utils
        ];

        jsPackages = jsBasePackages ++ pkgs.lib.optionals isLinux (jsLinuxPackages ++ [ android_sdk ]);

        jsLinuxLibraries = with jsPkgs; [
          gtk3
          libsoup_3
          webkitgtk_4_1
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl
          librsvg
          lsb-release
        ];

        jsDarwinLibraries = with jsPkgs; [
          openssl
          libiconv
        ];

        jsLibraries = if isDarwin then jsDarwinLibraries else jsLinuxLibraries;
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
              cargoArtifacts = workspaceArtifacts;
              cargoClippyExtraArgs = "--all-features -- -D warnings";
              RUSTDOCFLAGS = "-Dwarnings";
            }
          );
          gen-api =
            let
              openApiFiles = pkgs.lib.cleanSourceWith {
                src = ./js/app/packages/service-clients;
                filter = path: type: type == "directory" || pkgs.lib.hasSuffix "openapi.json" (baseNameOf path);
              };
              crateToDir = {
                document_storage_service = "service-storage";
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
          inherit
            cargoArtifacts
            workspaceArtifacts
            openApiBins
            nextestArchive
            ;
          default = cargoArtifacts;
        }
        // deployServiceBinaryPackages;

        devShells = {
          default = pkgs.mkShell (
            {
              buildInputs = shellTools ++ libraries;
              PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
              LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
              SOPS_KMS_ARN = "arn:aws:kms:us-east-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93,arn:aws:kms:us-west-1:569036502058:key/mrk-cab29bf948044eb79005a81f48d40e93";
              RUSTC_WRAPPER = "${pkgs.sccache}/bin/sccache";
            }
            // pkgs.lib.optionalAttrs isLinux {
              LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}";
              BINDGEN_EXTRA_CLANG_ARGS = "-I${pkgs.glibc.dev}/include -I${pkgs.gcc.cc}/lib/gcc/${pkgs.stdenv.hostPlatform.config}/${pkgs.gcc.version}/include";
            }
          );

          js-app = jsPkgs.mkShell (
            {
              buildInputs = jsPackages ++ jsLibraries;
              PKG_CONFIG_PATH = "${jsPkgs.openssl.dev}/lib/pkgconfig";
            }
            // pkgs.lib.optionalAttrs isLinux {
              LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath jsLibraries}:$LD_LIBRARY_PATH";
              XDG_DATA_DIRS = "${jsPkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${jsPkgs.gsettings-desktop-schemas.name}:${jsPkgs.gtk3}/share/gsettings-schemas/${jsPkgs.gtk3.name}:$XDG_DATA_DIRS";
              ANDROID_HOME = "${android_sdk}/libexec/android-sdk";
              NDK_HOME = "${android_sdk}/libexec/android-sdk/ndk/26.3.11579264";
              GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${android_sdk}/libexec/android-sdk/build-tools/35.0.0/aapt2";
              GIO_MODULE_DIR = "${jsPkgs.glib-networking}/lib/gio/modules/";
            }
          );
        };
      }
    );
}
