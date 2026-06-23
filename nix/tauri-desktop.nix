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
      isDarwin = pkgs.stdenv.hostPlatform.isDarwin;

      appVersion = (builtins.fromJSON (builtins.readFile ../js/app/packages/app/package.json)).version;
      gitRev = inputs.self.shortRev or inputs.self.dirtyShortRev or "unknown";

      rustToolchain = fenix.packages.${system}.fromToolchainFile {
        file = ../rust/rust-toolchain.toml;
        sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
      };
      craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

      jsRoot = ../js;
      jsSrc = lib.cleanSourceWith {
        src = jsRoot;
        filter =
          path: type:
          let
            rel = lib.removePrefix ((toString jsRoot) + "/") (toString path);
          in
          !(lib.hasPrefix "node_modules/" rel)
          && !(lib.hasPrefix "app/node_modules/" rel)
          && !(lib.hasPrefix "app/packages/app/dist/" rel)
          && !(lib.hasPrefix "app/tauri/target/" rel)
          && !(lib.hasPrefix "lexical-core/node_modules/" rel)
          && !(lib.hasPrefix "lexical-service/node_modules/" rel)
          && !(lib.hasPrefix "loro-mirror/node_modules/" rel)
          && !(lib.hasInfix "/node_modules/" rel)
          && !(lib.hasInfix "/target/" rel)
          && !(lib.hasInfix "/dist/" rel)
          && rel != "node_modules"
          && rel != "app/node_modules"
          && rel != "app/packages/app/dist"
          && rel != "app/tauri/target";
      };

      bunDeps = pkgs.stdenvNoCC.mkDerivation {
        pname = "macro-js-bun-deps";
        version = appVersion;
        src = jsSrc;

        nativeBuildInputs = with pkgs; [
          bun
          git
        ];

        dontConfigure = true;
        dontBuild = true;
        dontFixup = true;

        installPhase = ''
          runHook preInstall

          export HOME="$TMPDIR"
          export BUN_INSTALL_CACHE_DIR="$TMPDIR/bun-cache"
          bun install --frozen-lockfile --no-progress

          mkdir -p "$out"
          cp -a node_modules "$out/node_modules"

          runHook postInstall
        '';

        outputHashAlgo = "sha256";
        outputHashMode = "recursive";
        outputHash = "sha256-iRTxcszsC1TKGV34k2F8cBLW7Lt3FSGIN7smcHrVVkk=";
      };

      frontend = pkgs.stdenvNoCC.mkDerivation {
        pname = "macro-tauri-frontend";
        version = appVersion;
        src = jsSrc;

        nativeBuildInputs = with pkgs; [
          bun
          git
        ];

        dontConfigure = true;

        buildPhase = ''
          runHook preBuild

          export HOME="$TMPDIR"
          cp -a ${bunDeps}/node_modules ./node_modules
          chmod -R u+w ./node_modules

          printf production > app/tauri/src-tauri/.macro-tauri-env
          (
            cd app/packages/app
            MODE=production NODE_ENV=production bun ../../../node_modules/vite/bin/vite.js build -c vite.config.ts
            printf '${appVersion}+${gitRev}\n' > dist/semver.txt
            BUNDLE_BUILD_NUMBER=1 MIN_NATIVE_BUILD=0 bun scripts/write-bundle-manifest.mjs
          )

          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          cp -r app/packages/app/dist "$out"
          runHook postInstall
        '';
      };

      tauriCargoVendorDir = craneLib.vendorCargoDeps {
        src = ../js/app/tauri;
        cargoLock = ../js/app/tauri/Cargo.lock;
        outputHashes = {
          "git+https://github.com/macro-inc/tauri-plugins?rev=26537c8a46bb8424f9cf4021d08aa76aa7cd66ef#26537c8a46bb8424f9cf4021d08aa76aa7cd66ef" =
            "sha256-v0Pn8kiRXaczNrFNjXct7yZUQ50qP68l8ivQDumu7Hw=";
          "git+https://github.com/seanaye/plugins-workspace?branch=seanaye%2Ffeat%2Fwebsocket-cookies#c23e1d7b24391a79b5bcfc3df535452c17f1f01c" =
            "sha256-cxxQLB9q/Ajh0YkyyZ0AuLt9Syeq+g7LcSqNr05SDXo=";
          "git+https://github.com/seanaye/plugins-workspace?branch=seanaye/feat/websocket-cookies#c23e1d7b24391a79b5bcfc3df535452c17f1f01c" =
            "sha256-cxxQLB9q/Ajh0YkyyZ0AuLt9Syeq+g7LcSqNr05SDXo=";
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
        src = ../js/app/tauri;
        cargoRoot = ../js/app/tauri;
        cargoLock = ../js/app/tauri/Cargo.lock;
        inherit frontend;

        craneArgs.cargoVendorDir = tauriCargoVendorDir;
        craneArgs.postConfigure = ''
          writable_vendor="$TMPDIR/cargo-vendor"
          mkdir -p "$writable_vendor"
          cp -aL ${tauriCargoVendorDir}/. "$writable_vendor/"
          chmod -R u+w "$writable_vendor"
          substituteInPlace .cargo-home/config.toml \
            --replace-fail "${tauriCargoVendorDir}" "$writable_vendor"
        '';
        craneArgs.preBuild = ''
          mkdir -p ../packages/app
          cp ${../js/app/packages/app/package.json} ../packages/app/package.json
          rm -rf ../packages/app/dist
          cp -r ${frontend} ../packages/app/dist
        '';
      };

      wrappedTauriDesktop = pkgs.symlinkJoin {
        name = "macro-tauri-desktop-${appVersion}";
        paths = [ tauri.app ];
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
                pkgs.openssl
              ]
            } \
            --prefix XDG_DATA_DIRS : "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}"

          install -Dm0644 ${../js/app/tauri/src-tauri/icons/32x32.png} "$out/share/icons/hicolor/32x32/apps/macro.png"
          install -Dm0644 ${../js/app/tauri/src-tauri/icons/64x64.png} "$out/share/icons/hicolor/64x64/apps/macro.png"
          install -Dm0644 ${../js/app/tauri/src-tauri/icons/128x128.png} "$out/share/icons/hicolor/128x128/apps/macro.png"
          install -Dm0644 ${../js/app/tauri/src-tauri/icons/icon.png} "$out/share/icons/hicolor/256x256/apps/macro.png"
          install -Dm0644 /dev/stdin "$out/share/applications/macro.desktop" <<'EOF'
          [Desktop Entry]
          Type=Application
          Name=Macro
          Exec=app %U
          Icon=macro
          Categories=Office;Utility;
          MimeType=x-scheme-handler/macro;
          EOF
        '';
        meta.mainProgram = "app";
      };

      tauriBundlerSource = pkgs.cargo-tauri.src;
      tauriAppRun = pkgs.fetchurl {
        url = "https://github.com/tauri-apps/binary-releases/releases/download/apprun-old/AppRun-x86_64";
        hash = "sha256-8wFApDoKWeRtshve/fdJuenyxpRukq+rus+YuK5z+08=";
      };
      tauriLinuxdeployWrapper = pkgs.stdenv.mkDerivation {
        pname = "tauri-linuxdeploy-wrapper";
        version = "1";
        dontUnpack = true;
        buildPhase = ''
          cat > linuxdeploy-wrapper.c <<'EOF'
          #include <dirent.h>
          #include <stdio.h>
          #include <stdlib.h>
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

            char *slash = strrchr(argv[0], '/');
            if (slash != NULL) {
              size_t dir_len = (size_t)(slash - argv[0]);
              char *dir = strndup(argv[0], dir_len);
              char *old_path = getenv("PATH");
              size_t path_len = dir_len + 1 + (old_path ? strlen(old_path) : 0) + 1;
              char *path = malloc(path_len);
              snprintf(path, path_len, "%s:%s", dir, old_path ? old_path : "");
              setenv("PATH", path, 1);
            }

            char **args = calloc((size_t)argc + 1, sizeof(char *));
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
        url = "https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64";
        hash = "sha256-okGdzkdWg5WuecAf+ppaNB3TOVgTUv8QTQc1J1Qxd+U=";
      };
      tauriLinuxdeployAppimagePluginSource = pkgs.fetchurl {
        url = "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/continuous/linuxdeploy-plugin-appimage-x86_64.AppImage";
        hash = "sha256-4BKbgHDgx7NxUQJ+Run6RP6X6injaScFosXP83cdMSE=";
      };
      tauriLinuxdeployAppimagePluginExtracted = pkgs.appimageTools.extractType2 {
        pname = "linuxdeploy-plugin-appimage";
        version = "continuous";
        src = tauriLinuxdeployAppimagePluginSource;
      };
      tauriLinuxdeployAppimagePlugin = pkgs.stdenvNoCC.mkDerivation {
        pname = "linuxdeploy-plugin-appimage-patched";
        version = "continuous";
        dontUnpack = true;
        installPhase = ''
          mkdir -p "$out/lib/linuxdeploy-plugin-appimage" "$out/bin"
          cp -a ${tauriLinuxdeployAppimagePluginExtracted}/. "$out/lib/linuxdeploy-plugin-appimage/"
          chmod -R u+w "$out/lib/linuxdeploy-plugin-appimage"
          patchShebangs "$out/lib/linuxdeploy-plugin-appimage"
          printf '%s\n' \
            '#!${pkgs.runtimeShell}' \
            'exec "'$out'/lib/linuxdeploy-plugin-appimage/AppRun" "$@"' \
            > "$out/bin/linuxdeploy-plugin-appimage.AppImage"
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
        pkgs.openssl
      ];
      tauriRuntimeLibraryPath = lib.makeLibraryPath tauriRuntimeLibraries;
      tauriRuntimeClosure = pkgs.closureInfo {
        rootPaths = tauriRuntimeLibraries ++ tauri.commonArgs.buildInputs;
      };
      tauriAppImageConfig = builtins.toJSON {
        build = {
          frontendDist = "${frontend}";
          beforeBuildCommand = "";
        };
        bundle = {
          active = true;
          targets = [ "appimage" ];
          useLocalToolsDir = true;
          linux.appimage.files = {
            "/usr/bin/xdg-mime" = "${pkgs.xdg-utils}/bin/xdg-mime";
            "/usr/bin/xdg-open" = "${pkgs.xdg-utils}/bin/xdg-open";
          };
        };
      };
      tauriDesktopDmgSigningIdentity = builtins.getEnv "APPLE_SIGNING_IDENTITY";
      tauriDesktopDmgConfig = builtins.toJSON (
        lib.recursiveUpdate
          {
            build = {
              frontendDist = "${frontend}";
              beforeBuildCommand = "";
            };
            bundle = {
              active = true;
              targets = [ "dmg" ];
            };
          }
          (
            lib.optionalAttrs (tauriDesktopDmgSigningIdentity != "") {
              bundle.macOS.signingIdentity = tauriDesktopDmgSigningIdentity;
            }
          )
      );
      tauriDesktopDmg = craneLib.mkCargoDerivation (
        tauri.commonArgs
        // {
          cargoArtifacts = tauri.cargoArtifacts;
          pname = "macro-tauri-desktop-dmg";
          TAURI_CONFIG = tauriDesktopDmgConfig;
          APPLE_SIGNING_IDENTITY = tauriDesktopDmgSigningIdentity;
          nativeBuildInputs = tauri.commonArgs.nativeBuildInputs ++ [ pkgs.cargo-tauri ];
          preBuild = ''
            if [ -z "$APPLE_SIGNING_IDENTITY" ]; then
              echo "APPLE_SIGNING_IDENTITY must be set when building the signed macOS DMG; use nix build --impure." >&2
              exit 1
            fi
            export PATH="/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
            ${tauri.commonArgs.preBuild or ""}
          '';
          buildPhaseCargoCommand = ''
            cargo tauri build --bundles dmg \
              --features tauri/custom-protocol \
              --config "$TAURI_CONFIG"
          '';
          installPhaseCommand = ''
            dmgPath=$(find target -type f -path '*/release/bundle/dmg/*.dmg' -print -quit)
            if [ -z "$dmgPath" ]; then
              echo "failed to locate built DMG" >&2
              find target -path '*/bundle/*' -print >&2 || true
              exit 1
            fi

            mkdir -p "$out"
            cp "$dmgPath" "$out/Macro-${appVersion}-${system}.dmg"
          '';
          doInstallCargoArtifacts = false;
        }
      );

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
            pkgs.which
          ];
          LD_LIBRARY_PATH = tauriRuntimeLibraryPath;
          LDAI_RUNTIME_FILE = tauriAppImageRuntime;
          preBuild = ''
            ${tauri.commonArgs.preBuild or ""}

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
            patchShebangs target/.tauri/*.sh target/.tauri/linuxdeploy-plugin-appimage.AppImage
          '';
          buildPhaseCargoCommand = ''
            cargo tauri build --bundles appimage \
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
      apps = lib.optionalAttrs isLinux {
        tauri-desktop = {
          type = "app";
          program = "${wrappedTauriDesktop}/bin/app";
          meta.description = "Run the Macro Tauri desktop app";
        };
      };

      packages =
        lib.optionalAttrs isLinux {
          tauri-frontend = frontend;
          tauri-desktop = wrappedTauriDesktop;
          tauri-desktop-appimage = tauriDesktopAppImage;
          tauri-desktop-unwrapped = tauri.app;
          tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
        }
        // lib.optionalAttrs isDarwin {
          tauri-frontend = frontend;
          tauri-desktop-dmg = tauriDesktopDmg;
          tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
        };
    };
}
