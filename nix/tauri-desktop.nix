{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    let
      inherit (inputs)
        nixpkgs
        fenix
        crane
        crane-tauri
        ;
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      inherit (pkgs) lib;
      isLinux = pkgs.stdenv.hostPlatform.isLinux;
      isX86_64Linux = system == "x86_64-linux";
      isAarch64Darwin = system == "aarch64-darwin";

      desktopRelease = builtins.fromJSON (builtins.readFile ../apps/web/tauri/desktop-release.json);
      appVersion = desktopRelease.version;
      desktopPlugins = {
        desktop-update.enabled = desktopRelease.enabled;
        macro-bundle-updater.nativeBuild = desktopRelease.nativeBuild;
        updater = {
          pubkey = desktopRelease.publicKey;
          endpoints = [ desktopRelease.endpoint ];
        };
      };
      gitRev = inputs.self.shortRev or inputs.self.dirtyShortRev or "unknown";

      # Vite inlines `import.meta.env.VITE_*` at build time, so the desktop
      # bundle only reaches PostHog — and therefore only resolves feature
      # flags — when this key is present while the frontend derivation builds.
      # Evaluation is pure by default and `builtins.getEnv` then returns "", so
      # the release workflows export the key and build with `--impure` (see
      # `xtask_workflows/.../scripts/build_appimage.sh` and `build_dmg.sh`).
      # An empty value stays a warning-free flag-less build: that is what ad-hoc
      # local `nix build .#tauri-desktop-*` runs get. The value is a PostHog
      # *project* key, public by design — it ships inside every web and mobile
      # bundle already — so embedding it in the derivation is not a new exposure.
      posthogApiKey = builtins.getEnv "VITE_POSTHOG_API_KEY";

      # Without an exporter URL the bundle records spans and logs but never
      # sends them. Default to the production OTLP proxy like the iOS build
      # (`ios_production_telemetry` in `apps/web/scripts/ios-native-env.sh`);
      # export either variable and build with `--impure` to send elsewhere.
      # Export stays behind the `enable-browser-otel` PostHog flag.
      envOr =
        name: fallback:
        let
          value = builtins.getEnv name;
        in
        if value == "" then fallback else value;
      otelExporterUrl = envOr "VITE_OTEL_EXPORTER_URL" "https://macro-prox-prod.macroverse.workers.dev/i/otlp/v1/traces";
      otelEnv = envOr "VITE_OTEL_ENV" "prod";

      rustToolchain = fenix.packages.${system}.fromToolchainFile {
        file = ../rust-toolchain.toml;
        sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
      };
      craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;
      cefRustToolchain =
        (fenix.packages.${system}.fromToolchainName {
          name = "1.95.0";
          sha256 = "sha256-gh/xTkxKHL4eiRXzWv8KP7vfjSk61Iq48x47BEDFgfk=";
        }).toolchain;
      cefCraneLib = (crane.mkLib pkgs).overrideToolchain cefRustToolchain;

      jsRoot = ../.;
      jsSrc = lib.cleanSourceWith {
        src = jsRoot;
        filter =
          path: type:
          let
            rel = lib.removePrefix ((toString jsRoot) + "/") (toString path);
          in
          # Packaging helpers are separate derivation inputs, not frontend or
          # WASM sources. Avoid recompiling both for AppImage-only changes.
          rel != "nix"
          && !(lib.hasPrefix "nix/" rel)
          && !(lib.hasPrefix "nix-support/appimage-" rel)
          && !(lib.hasPrefix "node_modules/" rel)
          && !(lib.hasPrefix "apps/web/node_modules/" rel)
          && !(lib.hasPrefix "apps/web/dist/" rel)
          && !(lib.hasPrefix "apps/web/tauri/target/" rel)
          && !(lib.hasPrefix "apps/web/src/lib/graphql-cache/wasm/" rel)
          && !(lib.hasPrefix "apps/web/src/lib/core/agent-fold/wasm/" rel)
          && !(lib.hasPrefix "packages/lexical-core/node_modules/" rel)
          && !(lib.hasPrefix "services/lexical-service/node_modules/" rel)
          && !(lib.hasPrefix "packages/loro-mirror/node_modules/" rel)
          && !(lib.hasInfix "/node_modules/" rel)
          && !(lib.hasInfix "/target/" rel)
          && !(lib.hasInfix "/dist/" rel)
          && rel != "node_modules"
          && rel != "apps/web/node_modules"
          && rel != "apps/web/dist"
          && rel != "apps/web/tauri/target"
          && rel != "apps/web/src/lib/graphql-cache/wasm"
          && rel != "apps/web/src/lib/core/agent-fold/wasm";
      };

      rootCargoVendorDir = craneLib.vendorCargoDeps {
        src = ../.;
        cargoLock = ../Cargo.lock;
        outputHashes = import ../nix-support/root-cargo-output-hashes.nix;
      };

      cacheWasmPackage = craneLib.mkCargoDerivation {
        pname = "macro-cache-wasm";
        version = appVersion;
        src = jsSrc;
        cargoArtifacts = null;
        cargoVendorDir = rootCargoVendorDir;
        nativeBuildInputs = [
          pkgs.binaryen
          # wasm-pack requires the CLI version to exactly match Cargo.lock.
          pkgs.wasm-bindgen-cli_0_2_126
          pkgs.wasm-pack
        ];
        doCheck = false;
        preBuild = ''
          export HOME="$TMPDIR"
          export XDG_CACHE_HOME="$TMPDIR/xdg-cache"
        '';
        buildPhaseCargoCommand = ''
          wasm-pack build crates/client/cache-wasm \
            --target web \
            --release \
            --mode no-install \
            --out-dir "$PWD/apps/web/src/lib/graphql-cache/wasm"
        '';
        installPhaseCommand = ''
          mkdir -p $out
          cp -a apps/web/src/lib/graphql-cache/wasm/. $out/
        '';
        doInstallCargoArtifacts = false;
      };

      nodeModules = pkgs.callPackage ../nix-support/node_modules.nix {
        src = jsRoot;
      };

      agentFoldWasmPackage = craneLib.mkCargoDerivation {
        pname = "macro-agent-fold-wasm";
        version = appVersion;
        src = jsSrc;
        cargoArtifacts = null;
        cargoVendorDir = rootCargoVendorDir;
        nativeBuildInputs = [
          pkgs.binaryen
          pkgs.wasm-bindgen-cli_0_2_126
          pkgs.wasm-pack
        ];
        doCheck = false;
        preBuild = cacheWasmPackage.preBuild;
        buildPhaseCargoCommand = ''
          wasm-pack build crates/folds/agent_fold \
            --target web \
            --release \
            --mode no-install \
            --out-dir "$PWD/apps/web/src/lib/core/agent-fold/wasm" \
            -- --no-default-features
        '';
        installPhaseCommand = ''
          mkdir -p $out
          cp -a apps/web/src/lib/core/agent-fold/wasm/. $out/
        '';
        doInstallCargoArtifacts = false;
      };

      # The macrod agent daemon, bundled with the desktop app as a Tauri
      # sidecar so "run agents on this computer" needs no separate download.
      # Built from the root workspace (not the nested Tauri one), natively for
      # the bundle's platform; the standalone release tarballs keep their own
      # musl/darwin pipeline in build_agent_daemon_on_tag.yml.
      macrodBinary = craneLib.mkCargoDerivation {
        pname = "macrod";
        version = appVersion;
        src = jsSrc;
        cargoArtifacts = null;
        cargoVendorDir = rootCargoVendorDir;
        nativeBuildInputs = [
          # aws-lc-sys (rustls' crypto provider) and bundled librdkafka build
          # their C sources with cmake; see the matching notes on `libraries`
          # in cloud-storage.nix.
          pkgs.cmake
          pkgs.git
          pkgs.perl
          pkgs.pkg-config
        ];
        buildInputs = [
          pkgs.openssl
          pkgs.openssl.dev
          # librdkafka 2.12's bundled cmake-build needs curl headers even with
          # WITH_CURL=0 (headers only; nothing links against libcurl).
          pkgs.curl.dev
          pkgs.libclang
          pkgs.xz.out
        ]
        ++ lib.optionals pkgs.stdenv.isDarwin [ pkgs.libiconv ];
        LIBCLANG_PATH = "${pkgs.libclang.lib}/lib";
        OPENSSL_NO_VENDOR = "1";
        doCheck = false;
        SQLX_OFFLINE = "true";
        buildPhaseCargoCommand = ''
          cargo build --release --package coding_agent_worker --bin macrod
        '';
        installPhaseCommand = ''
          install -Dm0755 target/release/macrod "$out/bin/macrod"
        '';
        doInstallCargoArtifacts = false;
      };

      # Tauri sidecar sources carry the target triple in the file name; the
      # bundler strips it when placing the binary next to the app executable.
      rustHostTriple = pkgs.stdenv.hostPlatform.rust.rustcTarget;
      installMacrodSidecar = ''
        install -Dm0755 ${macrodBinary}/bin/macrod \
          "src-tauri/binaries/macrod-${rustHostTriple}"
      '';

      frontend = pkgs.stdenvNoCC.mkDerivation {
        pname = "macro-tauri-frontend";
        version = appVersion;
        src = jsSrc;

        nativeBuildInputs = [
          pkgs.bun
          pkgs.git
        ];

        dontConfigure = true;

        # Vite reads prefixed variables straight off the build environment, the
        # same way `just build-prod` picks them up in the web and Android jobs.
        VITE_POSTHOG_API_KEY = posthogApiKey;
        VITE_OTEL_EXPORTER_URL = otelExporterUrl;
        VITE_OTEL_ENV = otelEnv;

        buildPhase = ''
          runHook preBuild

          cp -a ${nodeModules}/. .

          # Vite bundles TypeScript config files to a temporary sibling before
          # loading them. The application config now lives at the app root,
          # so make that directory writable inside the Nix build sandbox.
          chmod u+w apps/web

          substituteInPlace apps/web/vite.base.ts \
            --replace-fail \
              "          // NIX_TAURI_ALIAS" \
              '          { find: /^@tauri-apps\/api/, replacement: resolve(__dirname, "../../node_modules/@tauri-apps/api") },'

          printf production > apps/web/tauri/src-tauri/.macro-tauri-env
          mkdir -p apps/web/src/lib/graphql-cache/wasm
          cp -a ${cacheWasmPackage}/. apps/web/src/lib/graphql-cache/wasm/
          mkdir -p apps/web/src/lib/core/agent-fold/wasm
          cp -a ${agentFoldWasmPackage}/. apps/web/src/lib/core/agent-fold/wasm/
          (
            cd apps/web
            MODE=production NODE_ENV=production bun ../../node_modules/vite/bin/vite.js build -c vite.config.ts
            printf '${appVersion}+${gitRev}\n' > dist/semver.txt
            BUNDLE_BUILD_NUMBER=${toString desktopRelease.bundleBuild} MIN_NATIVE_BUILD=0 bun scripts/write-bundle-manifest.mjs
          )

          # A supplied key that never reaches the bundle means PostHog — and
          # every feature flag behind it — is silently off in the shipped app.
          # Fail the build instead, the way the signed DMG fails on a missing
          # signing identity.
          if [ -n "''${VITE_POSTHOG_API_KEY:-}" ] \
            && ! grep -rqF -- "$VITE_POSTHOG_API_KEY" apps/web/dist; then
            echo "VITE_POSTHOG_API_KEY was set but Vite did not inline it into apps/web/dist" >&2
            exit 1
          fi

          runHook postBuild
        '';

        # Vite leaves new URL() imports unchanged when their generated source
        # files are absent. Reject that otherwise-successful but broken bundle.
        doCheck = true;
        checkPhase = ''
          runHook preCheck
          for asset in apps/web/dist/assets/agent_fold-*.js apps/web/dist/assets/agent_fold_bg-*.wasm; do
            test -s "$asset" || { echo "Missing agent fold bundle asset: $asset" >&2; exit 1; }
          done
          runHook postCheck
        '';

        installPhase = ''
          runHook preInstall
          cp -r apps/web/dist "$out"
          runHook postInstall
        '';
      };

      tauriCargoVendorDir = craneLib.vendorCargoDeps {
        src = ../apps/web/tauri;
        cargoLock = ../apps/web/tauri/Cargo.lock;
        outputHashes = {
          "git+https://github.com/macro-inc/tauri-plugins?rev=6ddd6600e20436388f169e936b610fe93944b7b0#6ddd6600e20436388f169e936b610fe93944b7b0" =
            "sha256-5ErLW2po5ZlTTuJjsCExwC//rHYcQo2tKXiyz3w/0kQ=";
          "git+https://github.com/macro-inc/plugins-workspace?rev=bc6ec3b8e80eed80ef4969f4463a357d46adb3b1#bc6ec3b8e80eed80ef4969f4463a357d46adb3b1" =
            "sha256-IdhZM/B8EyC/4/3HxQjkzNkrJeA68+43+rKity+iGLY=";
          "git+https://github.com/tursodatabase/turso?rev=79163249538197d01dec5ea7f65519454ed792e2#79163249538197d01dec5ea7f65519454ed792e2" =
            "sha256-7Noz7RMN+4nhlU5BBLzxZZ53nNFGewrr8BFMO1adkCo=";
          "git+https://github.com/seanaye/tauri?rev=95a7521b#95a7521b8c565cfba568319ddd8ba79c9ce244e2" =
            "sha256-5HamTWAZPtUSWOfP3TgtiqFJvunlPXy9/C0TLHQpXlU=";
          "git+https://github.com/voxelbee/tauri-plugin-virtual-keyboard?branch=main#70e8e8325b5ff7d681ef5f3b996ac083d4fc5a01" =
            "sha256-OdEp5mw0l5Euj0ry7gzNVxdB0jlGUq0N7XINXUhtE+c=";
        };
      };

      tauri = crane-tauri.lib.buildTauriApp { inherit pkgs craneLib; } {
        pname = "macro-tauri-desktop";
        version = appVersion;
        binaryName = "app";
        src = ../apps/web/tauri;
        # The native GraphQL cache plugin depends on cache-core/cache-turso
        # at the repository root, so preserve those relative paths in the
        # filtered Cargo source used by crane.
        cargoRoot = ../.;
        cargoLock = ../apps/web/tauri/Cargo.lock;
        # cache-core's build script generates metadata from the GraphQL schema.
        # Non-Cargo inputs must be added explicitly to crane's app fileset.
        extraFileset = lib.fileset.unions [
          ../static_assets/schema.graphql
          ../apps/web/tauri/src-tauri/tauri.macos.conf.json
        ];
        inherit frontend;

        craneArgs = {
          cargoVendorDir = tauriCargoVendorDir;
          CARGO_TARGET_DIR = "apps/web/tauri/target";
          # crane's common Cargo fileset only keeps the lockfile at cargoRoot.
          # Restore the nested Tauri workspace lockfile where Cargo discovers it.
          preConfigure = ''
            export CARGO_TARGET_DIR="$PWD/apps/web/tauri/target"
            install -Dm0644 ${../apps/web/tauri/Cargo.lock} apps/web/tauri/Cargo.lock
          '';
          postConfigure = ''
            writable_vendor="$TMPDIR/cargo-vendor"
            mkdir -p "$writable_vendor"
            cp -aL ${tauriCargoVendorDir}/. "$writable_vendor/"
            chmod -R u+w "$writable_vendor"
            substituteInPlace .cargo-home/config.toml \
              --replace-fail "${tauriCargoVendorDir}" "$writable_vendor"
          '';
        }
        // lib.optionalAttrs isAarch64Darwin {
          # Nix's linker crashes on the large final desktop binary. Use Apple's
          # linker for both dependencies and the app so Cargo can reuse them.
          CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER = tauriDesktopDmgAppleLinker;
        };
      };

      # Only final application builds need frontend assets. Including them in
      # craneArgs also invalidates buildDepsOnly whenever the frontend changes.
      tauriDesktopPreBuild = ''
        ${tauri.commonArgs.preBuild or ""}
        cp ${../apps/web/package.json} apps/web/package.json
        rm -rf apps/web/dist
        cp -r ${frontend} apps/web/dist
        cd apps/web/tauri
      '';

      tauriDesktopUnwrapped = tauri.app.overrideAttrs {
        preBuild = tauriDesktopPreBuild;
      };

      gioTlsModulePath = "${pkgs.glib-networking}/lib/gio/modules";

      wrappedTauriDesktop = pkgs.symlinkJoin {
        name = "macro-tauri-desktop-${appVersion}";
        paths = [ tauriDesktopUnwrapped ];
        nativeBuildInputs = [ pkgs.makeWrapper ];
        postBuild = ''
          wrapProgram "$out/bin/app" \
            --prefix LD_LIBRARY_PATH : ${
              lib.makeLibraryPath [
                pkgs.webkitgtk_4_1
                pkgs.libsoup_3
                pkgs.gtk3
                pkgs.glib
                pkgs.cairo
                pkgs.pango
                pkgs.gdk-pixbuf
                pkgs.atk
                pkgs.librsvg
                pkgs.libayatana-appindicator
                pkgs.dbus
                pkgs.gst_all_1.gstreamer
                pkgs.gst_all_1.gst-plugins-base
                pkgs.gst_all_1.gst-plugins-good
                pkgs.gst_all_1.gst-plugins-bad
                pkgs.gst_all_1.gst-libav
                pkgs.openssl
                pkgs.glib-networking
              ]
            } \
            --prefix GIO_EXTRA_MODULES : "${gioTlsModulePath}" \
            --prefix XDG_DATA_DIRS : "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}" \
            --prefix GST_PLUGIN_SYSTEM_PATH_1_0 : "${
              lib.makeSearchPathOutput "lib" "lib/gstreamer-1.0" [
                pkgs.gst_all_1.gstreamer
                pkgs.gst_all_1.gst-plugins-base
                pkgs.gst_all_1.gst-plugins-good
                pkgs.gst_all_1.gst-plugins-bad
                pkgs.gst_all_1.gst-libav
              ]
            }"

          install -Dm0644 ${../apps/web/tauri/src-tauri/icons/32x32.png} "$out/share/icons/hicolor/32x32/apps/macro.png"
          install -Dm0644 ${../apps/web/tauri/src-tauri/icons/64x64.png} "$out/share/icons/hicolor/64x64/apps/macro.png"
          install -Dm0644 ${../apps/web/tauri/src-tauri/icons/128x128.png} "$out/share/icons/hicolor/128x128/apps/macro.png"
          install -Dm0644 ${../apps/web/tauri/src-tauri/icons/icon.png} "$out/share/icons/hicolor/256x256/apps/macro.png"
          install -Dm0644 /dev/stdin "$out/share/applications/macro.desktop" <<EOF
          [Desktop Entry]
          Type=Application
          Name=Macro
          Exec=$out/bin/app %U
          Icon=macro
          Categories=Office;Utility;
          MimeType=x-scheme-handler/macro;
          EOF
        '';
        meta.mainProgram = "app";
      };

      tauriBundlerSource = pkgs.cargo-tauri.src;
      tauriAppRunSource = pkgs.fetchurl {
        url = "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64";
        hash = "sha256-8wFApDoKWeRtshve/fdJuenyxpRukq+rus+YuK5z+08=";
      };
      tauriAppRun = pkgs.runCommand "tauri-apprun" { } ''
        ${pkgs.python3}/bin/python3 ${./appimage/patch_apprun.py} ${tauriAppRunSource} "$out"
      '';
      tauriLinuxdeployWrapper = pkgs.stdenv.mkDerivation {
        pname = "tauri-linuxdeploy-wrapper";
        version = "1";
        dontUnpack = true;
        buildPhase = ''
          cat > linuxdeploy-wrapper.c <<'EOF'
          #include <dirent.h>
          #include <errno.h>
          #include <stdio.h>
          #include <stdlib.h>
          #include <sys/stat.h>
          #include <string.h>
          #include <unistd.h>

          static int has_suffix(const char *value, const char *suffix) {
            size_t value_len = strlen(value);
            size_t suffix_len = strlen(suffix);
            return value_len >= suffix_len && strcmp(value + value_len - suffix_len, suffix) == 0;
          }

          static void remove_if_exists(const char *path) {
            if (access(path, F_OK) == 0) {
              unlink(path);
            }
          }

          static void sanitize_appdir(const char *appdir) {
            if (appdir == NULL) return;
            DIR *dir = opendir(appdir);
            if (dir == NULL) return;

            size_t appdir_len = strlen(appdir);
            char *dir_icon = malloc(appdir_len + strlen("/.DirIcon") + 1);
            sprintf(dir_icon, "%s/.DirIcon", appdir);
            remove_if_exists(dir_icon);
            free(dir_icon);

            struct dirent *entry;
            while ((entry = readdir(dir)) != NULL) {
              if (has_suffix(entry->d_name, ".desktop")) {
                char *path = malloc(appdir_len + 1 + strlen(entry->d_name) + 1);
                sprintf(path, "%s/%s", appdir, entry->d_name);
                remove_if_exists(path);
                free(path);
              }
            }
            closedir(dir);
          }

          static int install_gio_tls_hook(const char *appdir) {
            if (appdir == NULL) {
              fprintf(stderr, "cannot install TLS hook: missing --appdir\n");
              return 1;
            }

            size_t appdir_len = strlen(appdir);
            char *hooks_dir = malloc(appdir_len + strlen("/apprun-hooks") + 1);
            if (hooks_dir == NULL) {
              perror("malloc TLS hook directory");
              return 1;
            }
            sprintf(hooks_dir, "%s/apprun-hooks", appdir);
            if (mkdir(hooks_dir, 0755) != 0 && errno != EEXIST) {
              perror("mkdir TLS hook directory");
              free(hooks_dir);
              return 1;
            }

            char *hook_path = malloc(strlen(hooks_dir) + strlen("/00-macro-runtime.sh") + 2);
            if (hook_path == NULL) {
              perror("malloc TLS hook path");
              free(hooks_dir);
              return 1;
            }
            sprintf(hook_path, "%s/00-macro-runtime.sh", hooks_dir);

            FILE *hook = fopen(hook_path, "w");
            if (hook == NULL) {
              perror("fopen TLS hook");
              free(hook_path);
              free(hooks_dir);
              return 1;
            }

            int failed = 0;
            if (fputs(${builtins.toJSON (builtins.readFile ./appimage/runtime-hook.sh)}, hook) == EOF) {
              perror("write TLS hook");
              failed = 1;
            }
            if (fclose(hook) != 0) {
              perror("close TLS hook");
              failed = 1;
            }
            if (!failed && chmod(hook_path, 0755) != 0) {
              perror("chmod TLS hook");
              failed = 1;
            }

            free(hook_path);
            free(hooks_dir);
            return failed;
          }

          int main(int argc, char **argv) {
            const char *appdir = NULL;
            for (int i = 1; i < argc; i++) {
              if (strcmp(argv[i], "--appdir") == 0 && i + 1 < argc) {
                appdir = argv[i + 1];
              } else if (strncmp(argv[i], "--appdir=", 9) == 0) {
                appdir = argv[i] + 9;
              }
            }
            sanitize_appdir(appdir);
            if (install_gio_tls_hook(appdir) != 0) {
              return 1;
            }

            char *slash = strrchr(argv[0], '/');
            if (slash != NULL) {
              size_t dir_len = (size_t)(slash - argv[0]);
              char *dir = strndup(argv[0], dir_len);
              char *old_path = getenv("PATH");
              const char *nix_ldd_dir = "${pkgs.glibc.bin}/bin";
              size_t path_len = dir_len + 1 + strlen(nix_ldd_dir) + 1 + (old_path ? strlen(old_path) : 0) + 1;
              char *path = malloc(path_len);
              snprintf(path, path_len, "%s:%s:%s", dir, nix_ldd_dir, old_path ? old_path : "");
              setenv("PATH", path, 1);
            }

            // These are loaded at runtime, so ldd on the main binary cannot
            // discover them. Deploy their dependency graphs as well.
            const char *runtime_args[] = {
              "--executable", "${pkgs.webkitgtk_4_1}/libexec/webkit2gtk-4.1/WebKitWebProcess",
              "--executable", "${pkgs.webkitgtk_4_1}/libexec/webkit2gtk-4.1/WebKitNetworkProcess",
              "--executable", "${pkgs.webkitgtk_4_1}/libexec/webkit2gtk-4.1/WebKitGPUProcess",
              "--library", "${pkgs.webkitgtk_4_1}/lib/webkit2gtk-4.1/injected-bundle/libwebkit2gtkinjectedbundle.so",
              "--library", "${appimageGioModulePath}/libgiognutls.so",
              "--library", "${appimageGioModulePath}/libgiognomeproxy.so",
              "--library", "${appimageGioModulePath}/libgiolibproxy.so",
            };
            size_t runtime_argc = sizeof(runtime_args) / sizeof(runtime_args[0]);
            char **args = calloc((size_t)argc + runtime_argc + 1, sizeof(char *));
            args[0] = "${pkgs.linuxdeploy}/bin/linuxdeploy";
            int out = 1;
            for (int i = 1; i < argc; i++) {
              if (strcmp(argv[i], "--appimage-extract-and-run") == 0) {
                continue;
              }
              if (strcmp(argv[i], "--plugin") == 0 && i + 1 < argc && strcmp(argv[i + 1], "gtk") == 0) {
                i++;
                continue;
              }
              if (strcmp(argv[i], "--plugin=gtk") == 0) {
                continue;
              }
              args[out++] = argv[i];
            }
            for (size_t i = 0; i < runtime_argc; i++) {
              args[out++] = (char *)runtime_args[i];
            }
            args[out] = NULL;
            execv(args[0], args);
            perror("execv linuxdeploy");
            return 127;
          }
          EOF
          $CC linuxdeploy-wrapper.c -o linuxdeploy-x86_64.AppImage
        '';
        installPhase = ''
          install -Dm0755 linuxdeploy-x86_64.AppImage "$out/bin/linuxdeploy-x86_64.AppImage"
        '';
      };
      tauriAppImageRuntime = pkgs.fetchurl {
        # Do not use the mutable "continuous" release: tag-push builds must be reproducible.
        url = "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64";
        hash = "sha256-L8qLRDySUQ8Ug6iD9gBhrQm0a5eLJjHIB82HOkfsJg0=";
      };
      tauriLinuxdeployAppimagePluginSource = pkgs.fetchurl {
        # Do not use the mutable "continuous" release: tag-push builds must be reproducible.
        url = "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/1-alpha-20250213-1/linuxdeploy-plugin-appimage-x86_64.AppImage";
        hash = "sha256-mS1QKiSOFKsYVEjd9vbn0lVYy4TUYjw1TDrzUMJfzLM=";
      };
      tauriLinuxdeployAppimagePluginExtracted = pkgs.appimageTools.extractType2 {
        pname = "linuxdeploy-plugin-appimage";
        version = "1-alpha-20250213-1";
        src = tauriLinuxdeployAppimagePluginSource;
      };
      tauriPortableLibproxy = pkgs.callPackage ../nix-support/appimage-libproxy.nix { };
      tauriPortableGlibNetworking = pkgs.callPackage ../nix-support/appimage-glib-networking.nix {
        libproxy = tauriPortableLibproxy;
      };
      appimageGioModulePath = "${tauriPortableGlibNetworking}/lib/gio/modules";
      tauriLinuxdeployAppimagePlugin = pkgs.stdenvNoCC.mkDerivation {
        pname = "linuxdeploy-plugin-appimage-patched";
        version = "1-alpha-20250213-1";
        dontUnpack = true;
        installPhase = ''
          mkdir -p "$out/lib/linuxdeploy-plugin-appimage" "$out/bin"
          cp -a ${tauriLinuxdeployAppimagePluginExtracted}/. "$out/lib/linuxdeploy-plugin-appimage/"
          chmod -R u+w "$out/lib/linuxdeploy-plugin-appimage"
          patchShebangs "$out/lib/linuxdeploy-plugin-appimage"
          cat > "$out/bin/linuxdeploy-plugin-appimage.AppImage" <<'EOF'
          #!${pkgs.runtimeShell}
          set -euo pipefail
          args=("$@")
          appdir=""
          while [ "$#" -gt 0 ]; do
            case "$1" in
              --appdir=*) appdir="''${1#--appdir=}" ;;
              --appdir) shift; appdir="$1" ;;
            esac
            shift
          done
          if [ -n "$appdir" ]; then
            # Same libproxy version/ABI and dependencies, but without nixpkgs'
            # hardcoded schema lookup. Replace the backend before ELF relocation.
            install -m0755 ${tauriPortableLibproxy}/lib/libproxy/libpxbackend-1.0.so "$appdir/usr/lib/libpxbackend-1.0.so"
            export PATH="${lib.makeBinPath [ pkgs.patchelf ]}:$PATH"
            ${pkgs.python3}/bin/python3 ${./appimage/relocate.py} "$appdir"
          fi
          exec @plugin@ "''${args[@]}"
          EOF
          substituteInPlace "$out/bin/linuxdeploy-plugin-appimage.AppImage" \
            --replace-fail '@plugin@' "$out/lib/linuxdeploy-plugin-appimage/AppRun"
          chmod 0755 "$out/bin/linuxdeploy-plugin-appimage.AppImage"
        '';
      };
      tauriRuntimeLibraries = [
        pkgs.webkitgtk_4_1
        pkgs.libsoup_3
        pkgs.gtk3
        pkgs.glib
        pkgs.cairo
        pkgs.pango
        pkgs.gdk-pixbuf
        pkgs.atk
        pkgs.librsvg
        pkgs.libayatana-appindicator
        pkgs.dbus
        pkgs.gst_all_1.gstreamer
        pkgs.gst_all_1.gst-plugins-base
        pkgs.gst_all_1.gst-plugins-good
        pkgs.gst_all_1.gst-plugins-bad
        pkgs.gst_all_1.gst-libav
        pkgs.openssl
        tauriPortableGlibNetworking
      ];
      tauriRuntimeLibraryPath = lib.makeLibraryPath tauriRuntimeLibraries;
      tauriRuntimeClosure = pkgs.closureInfo {
        rootPaths = tauriRuntimeLibraries ++ tauri.commonArgs.buildInputs;
      };
      tauriGstreamerPlugins = pkgs.symlinkJoin {
        name = "tauri-gstreamer-plugins";
        paths = map lib.getLib (
          with pkgs.gst_all_1;
          [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
            gst-libav
          ]
        );
      };
      # xkeyboard-config's compatibility path is a symlink. Tauri preserves
      # symlinks when copying directories, so stage a self-contained data tree.
      tauriXkbData = pkgs.runCommand "tauri-appimage-xkb-data" { } ''
        cp -rL ${pkgs.xkeyboard-config}/share/X11/xkb "$out"
      '';
      tauriXdgUtils = pkgs.callPackage ../nix-support/appimage-xdg-utils.nix { };
      tauriGsettingsSchemas =
        pkgs.runCommand "tauri-appimage-gsettings-schemas"
          {
            nativeBuildInputs = [ pkgs.glib.dev ];
            schemaDirs =
              lib.concatMapStringsSep " " (p: "${p}/share/gsettings-schemas/${p.name}/glib-2.0/schemas")
                [
                  pkgs.gsettings-desktop-schemas
                  pkgs.gtk3
                ];
          }
          ''
            mkdir -p "$out"
            shopt -s nullglob
            for schema_dir in $schemaDirs; do
              cp "$schema_dir/"*.xml "$out/"
              for override in "$schema_dir/"*.gschema.override; do
                cp "$override" "$out/"
              done
            done
            glib-compile-schemas --strict "$out"
          '';
      tauriAppImageConfig = builtins.toJSON {
        version = appVersion;
        plugins = desktopPlugins;
        build = {
          frontendDist = "${frontend}";
          beforeBuildCommand = "";
        };
        bundle = {
          active = true;
          targets = [ "appimage" ];
          useLocalToolsDir = true;
          externalBin = [ "binaries/macrod" ];
          linux.appimage.bundleMediaFramework = true;
          linux.appimage.files = {
            "/usr/bin/xdg-mime" = "${tauriXdgUtils}/bin/xdg-mime";
            "/usr/bin/xdg-open" = "${tauriXdgUtils}/bin/xdg-open";
            "/usr/libexec/macro" = "${tauriXdgUtils}/libexec/macro";
            "/usr/share/X11/xkb" = "${tauriXkbData}";
            "/usr/share/glib-2.0/schemas" = "${tauriGsettingsSchemas}";
            "/usr/lib/gio/modules/giomodule.cache" = "${appimageGioModulePath}/giomodule.cache";
            "/usr/lib/gio/modules/libgiognomeproxy.so" = "${appimageGioModulePath}/libgiognomeproxy.so";
            "/usr/lib/gio/modules/libgiognutls.so" = "${appimageGioModulePath}/libgiognutls.so";
            "/usr/lib/gio/modules/libgiolibproxy.so" = "${appimageGioModulePath}/libgiolibproxy.so";
          };
        };
      };
      tauriDesktopDmgSigningIdentity = builtins.getEnv "APPLE_SIGNING_IDENTITY";
      # The Developer ID provisioning profile that authorizes the communication
      # notifications entitlement. Profiles ship inside every app, so copying
      # it to the store exposes nothing.
      tauriDesktopDmgProvisioningProfilePath = builtins.getEnv "MACOS_PROVISIONING_PROFILE";
      tauriDesktopDmgProvisioningProfile = lib.optionalString (tauriDesktopDmgProvisioningProfilePath != "") (
        builtins.path {
          path = /. + tauriDesktopDmgProvisioningProfilePath;
          name = "macro.provisionprofile";
        }
      );
      tauriDesktopDmgAppleLd = pkgs.writeShellScriptBin "ld" ''
        appleDeveloperDir=$(
          unset DEVELOPER_DIR
          /usr/bin/xcode-select --print-path
        )
        appleLd="$appleDeveloperDir/Toolchains/XcodeDefault.xctoolchain/usr/bin/ld"
        if [ ! -x "$appleLd" ]; then
          appleLd=$(
            export DEVELOPER_DIR="$appleDeveloperDir"
            export PATH="/usr/bin:/bin:/usr/sbin:/sbin"
            unset SDKROOT TOOLCHAINS
            /usr/bin/xcrun --sdk macosx --find ld
          )
        fi
        if [ ! -x "$appleLd" ]; then
          echo "could not locate an executable Apple linker: $appleLd" >&2
          exit 1
        fi
        case "$appleDeveloperDir" in
          /nix/store/*)
            echo "xcode-select unexpectedly selected Nix: $appleDeveloperDir" >&2
            exit 1
            ;;
        esac
        case "$appleLd" in
          /nix/store/*)
            echo "Apple linker selection unexpectedly resolved to Nix for $appleDeveloperDir: $appleLd" >&2
            exit 1
            ;;
        esac
        if [ -n "''${TAURI_DESKTOP_APPLE_LD_MARKER:-}" ]; then
          printf '%s\n' "$appleLd" > "$TAURI_DESKTOP_APPLE_LD_MARKER"
        fi
        exec "$appleLd" "$@"
      '';
      tauriDesktopDmgAppleLinker = pkgs.writeShellScript "tauri-desktop-apple-linker" ''
        # Point clang at a known-present ld shim. The macOS clang driver ignored
        # /usr/bin in -B/PATH and otherwise kept selecting Nix's cctools wrapper.
        export PATH="${tauriDesktopDmgAppleLd}/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
        exec /usr/bin/clang -B"${tauriDesktopDmgAppleLd}/bin" "$@"
      '';
      tauriDesktopDmgAppleLinkerSmoke = pkgs.stdenv.mkDerivation {
        name = "tauri-desktop-apple-linker-smoke";
        dontUnpack = true;
        buildPhase = ''
          cat > smoke.c <<'EOF'
          int main(void) { return 0; }
          EOF
          export TAURI_DESKTOP_APPLE_LD_MARKER="$PWD/apple-ld-used"
          ${tauriDesktopDmgAppleLinker} -v smoke.c -o smoke
          if [ ! -s "$TAURI_DESKTOP_APPLE_LD_MARKER" ]; then
            echo "Apple clang did not invoke the xcrun-backed ld shim" >&2
            exit 1
          fi
          echo "Apple linker smoke test used $(cat "$TAURI_DESKTOP_APPLE_LD_MARKER")"
          ./smoke
        '';
        installPhase = ''
          touch "$out"
        '';
      };
      cefCliVendorDir = cefCraneLib.vendorCargoDeps {
        src = inputs.tauri-cef;
        cargoLock = inputs.tauri-cef + "/Cargo.lock";
        outputHashes = {
          "git+https://github.com/tauri-apps/plugins-workspace?branch=feat/cef#1423992771e0b57582ca3b06a6adc46ec26aa784" =
            "sha256-D2OrQkCjh8VrtWO+/0orsefx47ES8L5eT0AmaDVmoUg=";
          "git+https://github.com/tauri-apps/winit-gtk4?branch=master#3d7c7cd19d3c752f75762ceea535444e63bdf8de" =
            "sha256-2mFNnZcPnVqPQ2iakMoXSKXrlHiIv+HuQZ7iOwtrKb4=";
        };
      };
      cefTauriCli = cefCraneLib.mkCargoDerivation {
        pname = "cargo-tauri-cef";
        version = "2.11.4";
        src = inputs.tauri-cef;
        cargoArtifacts = null;
        cargoVendorDir = cefCliVendorDir;
        cargoLock = inputs.tauri-cef + "/Cargo.lock";
        nativeBuildInputs = [ pkgs.pkg-config ];
        buildInputs = [
          pkgs.openssl
          pkgs.libiconv
        ];
        CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER = tauriDesktopDmgAppleLinker;
        doCheck = false;
        buildPhaseCargoCommand = "cargo build --release -p tauri-cli";
        installPhaseCommand = ''
          install -Dm0755 target/release/cargo-tauri "$out/bin/cargo-tauri"
        '';
        doInstallCargoArtifacts = false;
      };
      cefCargoVendorDir = cefCraneLib.vendorCargoDeps {
        src = ../apps/web/tauri/desktop-cef;
        cargoLock = ../apps/web/tauri/desktop-cef/Cargo.lock;
        outputHashes = {
          "git+https://github.com/macro-inc/plugins-workspace?rev=bc6ec3b8e80eed80ef4969f4463a357d46adb3b1#bc6ec3b8e80eed80ef4969f4463a357d46adb3b1" =
            "sha256-IdhZM/B8EyC/4/3HxQjkzNkrJeA68+43+rKity+iGLY=";
          "git+https://github.com/macro-inc/tauri-plugins?rev=6ddd6600e20436388f169e936b610fe93944b7b0#6ddd6600e20436388f169e936b610fe93944b7b0" =
            "sha256-5ErLW2po5ZlTTuJjsCExwC//rHYcQo2tKXiyz3w/0kQ=";
          "git+https://github.com/macro-inc/tauri?rev=285fb6b1#285fb6b1cb2fc20666da1688f4c74e240a100035" =
            "sha256-++WQc4YpvoMPBFTuDj//856BguC1ArS6AeLTbIOn38Q=";
          "git+https://github.com/tauri-apps/winit-gtk4?rev=3d7c7cd19d3c752f75762ceea535444e63bdf8de#3d7c7cd19d3c752f75762ceea535444e63bdf8de" =
            "sha256-2mFNnZcPnVqPQ2iakMoXSKXrlHiIv+HuQZ7iOwtrKb4=";
          "git+https://github.com/tursodatabase/turso?rev=79163249538197d01dec5ea7f65519454ed792e2#79163249538197d01dec5ea7f65519454ed792e2" =
            "sha256-7Noz7RMN+4nhlU5BBLzxZZ53nNFGewrr8BFMO1adkCo=";
          "git+https://github.com/voxelbee/tauri-plugin-virtual-keyboard?branch=main#70e8e8325b5ff7d681ef5f3b996ac083d4fc5a01" =
            "sha256-OdEp5mw0l5Euj0ry7gzNVxdB0jlGUq0N7XINXUhtE+c=";
        };
      };
      cefCargoSources = cefCraneLib.fileset.commonCargoSources ../.;
      cefAppSrc = lib.fileset.toSource {
        root = ../.;
        fileset = lib.fileset.unions [
          cefCargoSources
          ../static_assets/schema.graphql
          ../apps/web/tauri/desktop-cef/tauri.conf.json
          ../apps/web/tauri/desktop-cef/entitlements.plist
          ../apps/web/tauri/src-tauri/tauri.conf.json
          ../apps/web/tauri/src-tauri/tauri.macos.conf.json
          ../apps/web/tauri/src-tauri/capabilities
          ../apps/web/tauri/src-tauri/icons
        ];
      };
      tauriDesktopCefConfig = builtins.toJSON {
        version = appVersion;
        plugins = desktopPlugins;
        build = {
          frontendDist = "${frontend}";
          beforeBuildCommand = "";
        };
        bundle = {
          active = true;
          targets = [ "app" ];
          externalBin = [ "binaries/macrod" ];
          cef.embed = true;
        };
      };
      tauriDesktopCefApp = cefCraneLib.mkCargoDerivation {
        pname = "macro-tauri-desktop-cef-app";
        version = appVersion;
        src = cefAppSrc;
        cargoArtifacts = null;
        cargoVendorDir = cefCargoVendorDir;
        cargoLock = ../apps/web/tauri/desktop-cef/Cargo.lock;
        TAURI_CONFIG = tauriDesktopCefConfig;
        nativeBuildInputs = [
          cefTauriCli
          pkgs.cmake
          pkgs.ninja
          pkgs.pkg-config
        ];
        buildInputs = [
          pkgs.openssl
          pkgs.libiconv
        ];
        CARGO_TARGET_AARCH64_APPLE_DARWIN_LINKER = tauriDesktopDmgAppleLinker;
        doCheck = false;
        preConfigure = ''
          export CARGO_TARGET_DIR="$PWD/apps/web/tauri/desktop-cef/target"
        '';
        preBuild = ''
          export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
          export CEF_PATH="$TMPDIR/tauri-cef"
          cp ${../apps/web/package.json} apps/web/package.json
          rm -rf apps/web/dist
          cp -r ${frontend} apps/web/dist
          printf production > apps/web/tauri/src-tauri/.macro-tauri-env
          install -Dm0755 ${macrodBinary}/bin/macrod \
            "apps/web/tauri/desktop-cef/binaries/macrod-${rustHostTriple}"
          install -Dm0755 ${macrodBinary}/bin/macrod \
            "apps/web/tauri/src-tauri/binaries/macrod-${rustHostTriple}"
          cd apps/web/tauri/desktop-cef
        '';
        buildPhaseCargoCommand = ''
          cargo tauri build --bundles app \
            --features tauri/custom-protocol \
            --config "$TAURI_CONFIG"
        '';
        installPhaseCommand = ''
          appPath=$(find "$CARGO_TARGET_DIR" -type d -path '*/release/bundle/macos/*.app' -print -quit)
          if [ -z "$appPath" ]; then
            echo "failed to locate built macOS Chromium app bundle" >&2
            find "$CARGO_TARGET_DIR" -path '*/bundle/*' -print >&2 || true
            exit 1
          fi
          test -d "$appPath/Contents/Frameworks/Chromium Embedded Framework.framework"
          mkdir -p "$out"
          cp -a "$appPath" "$out/Macro.app"
        '';
        doInstallCargoArtifacts = false;
      };
      tauriDesktopDmg = pkgs.stdenvNoCC.mkDerivation {
        pname = "macro-tauri-desktop-dmg";
        version = appVersion;
        APPLE_SIGNING_IDENTITY = tauriDesktopDmgSigningIdentity;
        MACOS_PROVISIONING_PROFILE = tauriDesktopDmgProvisioningProfile;
        nativeBuildInputs = [
          pkgs.coreutils
          (pkgs.python3.withPackages (ps: [ ps.ds-store ]))
        ];
        dontUnpack = true;
        dontConfigure = true;
        dontBuild = true;
        installPhase = ''
          if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
            echo "APPLE_SIGNING_IDENTITY must be set when building the signed macOS DMG; use nix build --impure." >&2
            exit 1
          fi
          if [ "$APPLE_SIGNING_IDENTITY" != "-" ] && [ -z "$MACOS_PROVISIONING_PROFILE" ]; then
            echo "MACOS_PROVISIONING_PROFILE must name the Developer ID provisioning profile when signing with a Developer ID; use nix build --impure." >&2
            exit 1
          fi
          export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
          appPath="$TMPDIR/Macro.app"
          cp -a ${tauriDesktopCefApp}/Macro.app "$appPath"
          chmod -R u+w "$appPath"

          bundle_nix_dylibs() {
            local app="$1"
            local frameworks="$app/Contents/Frameworks"
            mkdir -p "$frameworks"

            local -a queue=()
            while IFS= read -r -d "" mach_o; do
              if otool -hv "$mach_o" >/dev/null 2>&1; then
                queue+=("$mach_o")
              fi
            done < <(find "$app/Contents/MacOS" "$frameworks" -type f -print0)

            local processed="$TMPDIR/bundled-mach-o-files"
            : > "$processed"

            copy_dep() {
              local dep="$1"
              local base
              base=$(basename "$dep")
              local dest="$frameworks/$base"
              if [ ! -e "$dest" ]; then
                echo "Bundling Nix dylib $dep -> $dest" >&2
                cp -L "$dep" "$dest"
                chmod u+w "$dest"
                queue+=("$dest")
              fi
            }

            local i=0
            while [ "$i" -lt "''${#queue[@]}" ]; do
              local binary="''${queue[$i]}"
              i=$((i + 1))

              if grep -Fxq "$binary" "$processed"; then
                continue
              fi
              printf '%s\n' "$binary" >> "$processed"

              local deps
              deps=$(otool -L "$binary" 2>/dev/null | awk 'NR > 1 { print $1 }' | grep '^/nix/store/.*\.dylib$' || true)
              if [ -z "$deps" ]; then
                continue
              fi

              chmod u+w "$binary"
              local relative_frameworks
              relative_frameworks=$(${pkgs.python3}/bin/python -c \
                'import os, sys; print(os.path.relpath(sys.argv[1], sys.argv[2]))' \
                "$frameworks" "$(dirname "$binary")")
              local prefix="@loader_path/$relative_frameworks"
              if [ "$(dirname "$binary")" = "$frameworks" ]; then
                install_name_tool -id "@loader_path/$(basename "$binary")" "$binary"
              fi

              while IFS= read -r dep; do
                [ -n "$dep" ] || continue
                copy_dep "$dep"
                install_name_tool -change "$dep" "$prefix/$(basename "$dep")" "$binary"
              done <<< "$deps"
            done

            local remaining_refs="$TMPDIR/remaining-nix-dylib-refs"
            : > "$remaining_refs"
            while IFS= read -r -d "" file; do
              otool -L "$file" 2>/dev/null \
                | awk -v file="$file" 'NR > 1 && $1 ~ "^/nix/store/.*\\.dylib$" { print file ": " $1 }' \
                >> "$remaining_refs" || true
            done < <(find "$app/Contents/MacOS" "$app/Contents/Frameworks" -type f -print0)

            if [ -s "$remaining_refs" ]; then
              echo "App bundle still contains absolute Nix dylib references:" >&2
              cat "$remaining_refs" >&2
              exit 1
            fi
          }

          sign_darwin_app() {
            local app="$1"
            local -a sign_args=(--force --sign "$APPLE_SIGNING_IDENTITY")
            if [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
              sign_args+=(--timestamp --options runtime)
            fi
            local -a executable_sign_args=("''${sign_args[@]}" --entitlements ${../apps/web/tauri/desktop-cef/entitlements.plist})

            if [ -d "$app/Contents/Frameworks" ]; then
              while IFS= read -r -d "" file; do
                if otool -hv "$file" >/dev/null 2>&1; then
                  codesign "''${sign_args[@]}" "$file"
                fi
              done < <(find "$app/Contents/Frameworks" -type f -print0)
              # CEF ships a framework and five nested helper apps. Seal the
              # bundles after their Mach-O files, from the inside out.
              while IFS= read -r -d "" bundle; do
                case "$bundle" in
                  *.app) codesign "''${executable_sign_args[@]}" "$bundle" ;;
                  *) codesign "''${sign_args[@]}" "$bundle" ;;
                esac
              done < <(find "$app/Contents/Frameworks" -depth -type d \
                \( -name '*.framework' -o -name '*.app' \) -print0)
            fi

            # Helper executables (the macrod sidecar) must be signed
            # individually for notarization.
            while IFS= read -r -d "" file; do
              if otool -hv "$file" >/dev/null 2>&1; then
                codesign "''${executable_sign_args[@]}" "$file"
              fi
            done < <(find "$app/Contents/MacOS" -type f -print0)

            # Nested code is signed above, so seal the bundle without --deep:
            # the app's restricted entitlements must not reach the CEF helpers
            # or the macrod sidecar.
            local -a app_sign_args=("''${executable_sign_args[@]}")
            if [ "$APPLE_SIGNING_IDENTITY" != "-" ]; then
              cp "$MACOS_PROVISIONING_PROFILE" "$app/Contents/embedded.provisionprofile"
              write_app_entitlements "$app" "$TMPDIR/macro.entitlements"
              app_sign_args=("''${sign_args[@]}" --entitlements "$TMPDIR/macro.entitlements")
            fi
            codesign "''${app_sign_args[@]}" "$app"
            codesign --verify --deep --strict --verbose=2 "$app"
          }

          # Add the profile-backed entitlements to CEF's, after checking the
          # profile grants them to this bundle identifier. Communication
          # notifications show senders' avatars in macOS notifications.
          write_app_entitlements() {
            local app="$1" out="$2"
            local profile="$TMPDIR/macro-provisionprofile.plist"
            security cms -D -i "$MACOS_PROVISIONING_PROFILE" > "$profile"
            local team_id bundle_id app_id communication
            team_id=$(/usr/libexec/PlistBuddy -c 'Print :TeamIdentifier:0' "$profile")
            bundle_id=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$app/Contents/Info.plist")
            app_id=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.application-identifier' "$profile")
            if [ "$app_id" != "$team_id.$bundle_id" ]; then
              echo "Provisioning profile is for $app_id, not $team_id.$bundle_id" >&2
              exit 1
            fi
            communication=$(/usr/libexec/PlistBuddy -c 'Print :Entitlements:com.apple.developer.usernotifications.communication' "$profile" 2>/dev/null || true)
            if [ "$communication" != "true" ]; then
              echo "Provisioning profile does not grant com.apple.developer.usernotifications.communication" >&2
              exit 1
            fi
            cp ${../apps/web/tauri/desktop-cef/entitlements.plist} "$out"
            chmod u+w "$out"
            /usr/libexec/PlistBuddy \
              -c "Add :com.apple.application-identifier string $app_id" \
              -c "Add :com.apple.developer.team-identifier string $team_id" \
              -c 'Add :com.apple.developer.usernotifications.communication bool true' \
              "$out"
          }

          bundle_nix_dylibs "$appPath"
          sign_darwin_app "$appPath"

          mkdir -p "$out"
          # Export the final, relocated and signed app for updater packaging.
          # Notarization, stapling and updater signing happen outside the store.
          cp -a "$appPath" "$out/Macro.app"
          dmgPath="$out/Macro-${appVersion}-${system}.dmg"
          # Package a drag-to-install volume, including Finder's icon layout.
          dmgRoot=$(mktemp -d "$TMPDIR/macro-dmg.XXXXXX")
          cp -a "$appPath" "$dmgRoot/Macro.app"
          ln -s /Applications "$dmgRoot/Applications"
          ${pkgs.python3.withPackages (ps: [ ps.ds-store ])}/bin/python \
            ${./dmg-layout.py} "$dmgRoot"
          # hdiutil's automatic APFS sizing can run out of space while copying
          # the app. Budget logical bytes (including sparse files), then leave
          # 25% plus 64 MiB for filesystem metadata and temporary allocations.
          appSize=$(${pkgs.coreutils}/bin/du --apparent-size --count-links --block-size=1 --summarize "$appPath")
          read -r appBytes _ <<< "$appSize"
          appSizeMiB=$(( (appBytes + 1048575) / 1048576 ))
          dmgSizeMiB=$(( appSizeMiB + (appSizeMiB + 3) / 4 + 64 ))
          echo "DMG sizing: app=$appBytes logical bytes, image=$dmgSizeMiB MiB"
          df -h "$TMPDIR" "$out"
          hdiutil create \
            -fs APFS \
            -size "$dmgSizeMiB"m \
            -volname "Macro" \
            -srcfolder "$dmgRoot" \
            -ov \
            -format UDZO \
            "$dmgPath"

          if [ "$APPLE_SIGNING_IDENTITY" = "-" ]; then
            codesign --force --sign - "$dmgPath"
          else
            codesign --force --sign "$APPLE_SIGNING_IDENTITY" --timestamp "$dmgPath"
          fi
          codesign --verify --strict --verbose=2 "$dmgPath"
        '';
      };

      tauriAppImagePackagingTests =
        pkgs.runCommand "tauri-appimage-packaging-tests"
          {
            nativeBuildInputs = [
              pkgs.python3
              pkgs.patchelf
              pkgs.stdenv.cc
              pkgs.pkg-config
            ];
            buildInputs = [
              pkgs.libxkbcommon
              pkgs.glib
            ];
          }
          ''
            export PYTHONDONTWRITEBYTECODE=1
            python3 -m unittest discover -s ${./appimage} -v
            bash ${./appimage}/test_runtime.sh \
              ${tauriXkbData} ${tauriGsettingsSchemas} ${appimageGioModulePath} ${tauriAppRun} \
              ${tauriPortableLibproxy} ${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt
            bash ${./appimage}/test_xdg.sh ${tauriXdgUtils}
            # GStreamer's default Nix output is bin; its scanner and core plugins
            # live in the library output. Do not silently ship an empty helper dir.
            test -x ${lib.getLib pkgs.gst_all_1.gstreamer}/libexec/gstreamer-1.0/gst-plugin-scanner
            test -f ${tauriGstreamerPlugins}/lib/gstreamer-1.0/libgstcoreelements.so
            test -f ${tauriGstreamerPlugins}/lib/gstreamer-1.0/libgstapp.so
            touch "$out"
          '';

      tauriDesktopAppImage = craneLib.mkCargoDerivation (
        tauri.commonArgs
        // {
          cargoArtifacts = tauri.cargoArtifacts;
          pname = "macro-tauri-desktop-appimage";
          TAURI_CONFIG = tauriAppImageConfig;
          nativeBuildInputs = tauri.commonArgs.nativeBuildInputs ++ [
            pkgs.cargo-tauri
            pkgs.bash
            pkgs.coreutils
            pkgs.diffutils
            pkgs.file
            pkgs.findutils
            pkgs.gawk
            pkgs.gnugrep
            pkgs.gnused
            pkgs.patchelf
            pkgs.python3
            pkgs.which
          ];
          LD_LIBRARY_PATH = tauriRuntimeLibraryPath;
          LDAI_RUNTIME_FILE = tauriAppImageRuntime;
          GSTREAMER_PLUGINS_DIR = "${tauriGstreamerPlugins}/lib/gstreamer-1.0";
          GSTREAMER_HELPERS_DIR = "${lib.getLib pkgs.gst_all_1.gstreamer}/libexec/gstreamer-1.0";
          preBuild = ''
            test -e ${tauriAppImagePackagingTests}
            ${tauriDesktopPreBuild}
            ${installMacrodSidecar}

            runtime_library_path="$(while IFS= read -r store_path; do
              if [ -d "$store_path/lib" ]; then
                printf '%s:' "$store_path/lib"
              fi
            done < ${tauriRuntimeClosure}/store-paths)"
            export LD_LIBRARY_PATH="$runtime_library_path$LD_LIBRARY_PATH"

            mkdir -p target/.tauri
            install -m 0755 ${tauriAppRun} target/.tauri/AppRun-x86_64
            install -m 0755 ${tauriLinuxdeployWrapper}/bin/linuxdeploy-x86_64.AppImage target/.tauri/linuxdeploy-x86_64.AppImage
            install -m 0755 ${tauriLinuxdeployAppimagePlugin}/bin/linuxdeploy-plugin-appimage.AppImage target/.tauri/linuxdeploy-plugin-appimage.AppImage
            install -m 0755 ${tauriBundlerSource}/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy-plugin-gtk.sh target/.tauri/linuxdeploy-plugin-gtk.sh
            install -m 0755 ${tauriBundlerSource}/crates/tauri-bundler/src/bundle/linux/appimage/linuxdeploy-plugin-gstreamer.sh target/.tauri/linuxdeploy-plugin-gstreamer.sh
            # The upstream plugin copies Nix's read-only modes, then immediately
            # calls patchelf on those copies. Make both libraries and helpers writable.
            substituteInPlace target/.tauri/linuxdeploy-plugin-gstreamer.sh \
              --replace-fail 'cp "$i" "$plugins_target_dir"' 'install -m0755 "$i" "$plugins_target_dir"' \
              --replace-fail 'cp "$i" "$helpers_target_dir"' 'install -m0755 "$i" "$helpers_target_dir"'
            install -m 0755 ${./appimage/ldd.py} target/.tauri/ldd
            patchShebangs target/.tauri/*.sh target/.tauri/ldd target/.tauri/linuxdeploy-plugin-appimage.AppImage
          '';
          buildPhaseCargoCommand = ''
            cargo tauri build --verbose --bundles appimage \
              --features tauri/custom-protocol \
              --config "$TAURI_CONFIG"
          '';
          installPhaseCommand = ''
            appimagePath=$(find target -type f -path '*/release/bundle/appimage/*.AppImage' -print -quit)
            if [ -z "$appimagePath" ]; then
              echo "failed to locate built AppImage" >&2
              find target -path '*/bundle/*' -print >&2 || true
              exit 1
            fi

            mkdir -p "$out"
            cp "$appimagePath" "$out/Macro-${appVersion}-${system}.AppImage"
            chmod 0755 "$out/Macro-${appVersion}-${system}.AppImage"
          '';
          doInstallCargoArtifacts = false;
        }
      );
    in
    {
      checks = lib.optionalAttrs isX86_64Linux {
        tauri-appimage-packaging = tauriAppImagePackagingTests;
      };

      apps = lib.optionalAttrs isLinux {
        tauri-desktop = {
          type = "app";
          program = "${wrappedTauriDesktop}/bin/app";
          meta.description = "Run the Macro Tauri desktop app";
        };
      };

      packages = {
        js-node-modules = nodeModules;
        macrod = macrodBinary;
      }
      // lib.optionalAttrs isLinux {
        tauri-frontend = frontend;
        tauri-desktop = wrappedTauriDesktop;
        tauri-desktop-unwrapped = tauriDesktopUnwrapped;
        tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
      }
      // lib.optionalAttrs isX86_64Linux {
        tauri-desktop-appimage = tauriDesktopAppImage;
      }
      // lib.optionalAttrs isAarch64Darwin {
        tauri-frontend = frontend;
        tauri-desktop-cef-app = tauriDesktopCefApp;
        tauri-desktop-dmg = tauriDesktopDmg;
        tauri-desktop-apple-linker-smoke = tauriDesktopDmgAppleLinkerSmoke;
      };
    };
}
