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

      appVersion = (builtins.fromJSON (builtins.readFile ../apps/web/package.json)).version;
      gitRev = inputs.self.shortRev or inputs.self.dirtyShortRev or "unknown";

      rustToolchain = fenix.packages.${system}.fromToolchainFile {
        file = ../rust-toolchain.toml;
        sha256 = "sha256-qqF33vNuAdU5vua96VKVIwuc43j4EFeEXbjQ6+l4mO4=";
      };
      craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchain;

      jsRoot = ../.;
      jsSrc = lib.cleanSourceWith {
        src = jsRoot;
        filter =
          path: type:
          let
            rel = lib.removePrefix ((toString jsRoot) + "/") (toString path);
          in
          !(lib.hasPrefix "node_modules/" rel)
          && !(lib.hasPrefix "apps/web/node_modules/" rel)
          && !(lib.hasPrefix "apps/web/dist/" rel)
          && !(lib.hasPrefix "apps/web/tauri/target/" rel)
          && !(lib.hasPrefix "apps/web/src/lib/graphql-cache/wasm/" rel)
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
          && rel != "apps/web/src/lib/graphql-cache/wasm";
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
          pkgs.wasm-bindgen-cli
          pkgs.wasm-pack
        ];
        doCheck = false;
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

      frontend = pkgs.stdenvNoCC.mkDerivation {
        pname = "macro-tauri-frontend";
        version = appVersion;
        src = jsSrc;

        nativeBuildInputs = [
          pkgs.bun
          pkgs.git
        ];

        dontConfigure = true;

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
            (
              cd apps/web
              MODE=production NODE_ENV=production bun ../../node_modules/vite/bin/vite.js build -c vite.config.ts
              printf '${appVersion}+${gitRev}\n' > dist/semver.txt
              BUNDLE_BUILD_NUMBER=1 MIN_NATIVE_BUILD=0 bun scripts/write-bundle-manifest.mjs
            )

            runHook postBuild
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
          "git+https://github.com/macro-inc/tauri-plugins?rev=26537c8a46bb8424f9cf4021d08aa76aa7cd66ef#26537c8a46bb8424f9cf4021d08aa76aa7cd66ef" =
            "sha256-v0Pn8kiRXaczNrFNjXct7yZUQ50qP68l8ivQDumu7Hw=";
          "git+https://github.com/macro-inc/plugins-workspace?rev=06474e4c446600627cf37a11f0c22c27bcf764ca#06474e4c446600627cf37a11f0c22c27bcf764ca" =
            "sha256-ngH5sltERe8DlP/zjsin9jmlGOZFeABk8SxJ5AnZG18=";
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
        cargoRoot = ../apps/web/tauri;
        cargoLock = ../apps/web/tauri/Cargo.lock;
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
          cp ${../apps/web/package.json} ../package.json
          rm -rf ../dist
          cp -r ${frontend} ../dist
        '';
      };

      gioTlsModulePath = "${pkgs.glib-networking}/lib/gio/modules";

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

            char *hook_path = malloc(strlen(hooks_dir) + strlen("/macro-gio-tls.sh") + 2);
            if (hook_path == NULL) {
              perror("malloc TLS hook path");
              free(hooks_dir);
              return 1;
            }
            sprintf(hook_path, "%s/macro-gio-tls.sh", hooks_dir);

            FILE *hook = fopen(hook_path, "w");
            if (hook == NULL) {
              perror("fopen TLS hook");
              free(hook_path);
              free(hooks_dir);
              return 1;
            }

            int failed = 0;
            if (fputs("#! /usr/bin/env bash\n"
                      "export APPDIR=\"''${APPDIR:-\"$(dirname \"$(realpath \"$0\")\")\"}\"\n"
                      "gio_modules=\"$APPDIR/usr/lib/gio/modules\"\n"
                      "if [ -d \"$gio_modules\" ]; then\n"
                      "  case \":''${GIO_EXTRA_MODULES:-}:\" in\n"
                      "    *:\"$gio_modules\":*) ;;\n"
                      "    *) export GIO_EXTRA_MODULES=\"$gio_modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}\" ;;\n"
                      "  esac\n"
                      "fi\n",
                      hook) == EOF) {
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
        # Do not use the mutable "continuous" release: tag-push builds must be reproducible.
        url = "https://github.com/AppImage/type2-runtime/releases/download/20251108/runtime-x86_64";
        hash = "sha256-L8qLRDySUQ8Ug6iD9gBhrQm0a5eLJjHIB82HOkfsJg0=";
      };
      tauriLinuxdeployAppimagePluginSource = pkgs.fetchurl {
        # Do not use the mutable "continuous" release: tag-push builds must be reproducible.
        url = "https://github.com/linuxdeploy/linuxdeploy-plugin-appimage/releases/download/1-alpha-20250213-1/linuxdeploy-plugin-appimage-x86_64.AppImage";
        hash = "sha256-psPPOB4jSR61J5Tsuiqb1F5k2okJetKF4l72l0nuKa4=";
      };
      tauriLinuxdeployAppimagePluginExtracted = pkgs.appimageTools.extractType2 {
        pname = "linuxdeploy-plugin-appimage";
        version = "1-alpha-20250213-1";
        src = tauriLinuxdeployAppimagePluginSource;
      };
      tauriLinuxdeployAppimagePlugin = pkgs.stdenvNoCC.mkDerivation {
        pname = "linuxdeploy-plugin-appimage-patched";
        version = "1-alpha-20250213-1";
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
        pkgs.dbus
        pkgs.gst_all_1.gstreamer
        pkgs.gst_all_1.gst-plugins-base
        pkgs.gst_all_1.gst-plugins-good
        pkgs.gst_all_1.gst-plugins-bad
        pkgs.gst_all_1.gst-libav
        pkgs.openssl
        pkgs.glib-networking
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
            "/usr/lib/gio/modules/giomodule.cache" = "${pkgs.glib-networking}/lib/gio/modules/giomodule.cache";
            "/usr/lib/gio/modules/libgiognomeproxy.so" = "${pkgs.glib-networking}/lib/gio/modules/libgiognomeproxy.so";
            "/usr/lib/gio/modules/libgiognutls.so" = "${pkgs.glib-networking}/lib/gio/modules/libgiognutls.so";
            "/usr/lib/gio/modules/libgiolibproxy.so" = "${pkgs.glib-networking}/lib/gio/modules/libgiolibproxy.so";
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
              targets = [ "app" ];
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
            export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"
            ${tauri.commonArgs.preBuild or ""}
          '';
          buildPhaseCargoCommand = ''
            cargo tauri build --bundles app \
              --features tauri/custom-protocol \
              --config "$TAURI_CONFIG"
          '';
          installPhaseCommand = ''
            export PATH="$PATH:/usr/bin:/bin:/usr/sbin:/sbin"

            appPath=$(find target -type d -path '*/release/bundle/macos/*.app' -print -quit)
            if [ -z "$appPath" ]; then
              echo "failed to locate built macOS app bundle" >&2
              find target -path '*/bundle/*' -print >&2 || true
              exit 1
            fi

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

                chmod u+w "$binary" || true
                local prefix="@loader_path"
                case "$binary" in
                  "$app/Contents/MacOS/"*) prefix="@executable_path/../Frameworks" ;;
                  *) install_name_tool -id "@loader_path/$(basename "$binary")" "$binary" 2>/dev/null || true ;;
                esac

                local deps
                deps=$(otool -L "$binary" 2>/dev/null | awk 'NR > 1 { print $1 }' | grep '^/nix/store/.*\.dylib$' || true)
                if [ -z "$deps" ]; then
                  continue
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

              if [ -d "$app/Contents/Frameworks" ]; then
                while IFS= read -r -d "" file; do
                  if otool -hv "$file" >/dev/null 2>&1; then
                    codesign "''${sign_args[@]}" "$file"
                  fi
                done < <(find "$app/Contents/Frameworks" -type f -print0)
              fi

              codesign "''${sign_args[@]}" --deep "$app"
              codesign --verify --deep --strict --verbose=2 "$app"
            }

            bundle_nix_dylibs "$appPath"
            sign_darwin_app "$appPath"

            mkdir -p "$out"
            dmgPath="$out/Macro-${appVersion}-${system}.dmg"
            hdiutil create \
              -volname "Macro" \
              -srcfolder "$appPath" \
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
            cat > target/.tauri/ldd <<'EOF'
            #!${pkgs.runtimeShell}
            set -euo pipefail

            binary="''${1:?usage: ldd <elf>}"
            if ! needed=$(patchelf --print-needed "$binary" 2>/dev/null); then
              echo "not a dynamic executable"
              exit 1
            fi

            origin=$(cd "$(dirname "$binary")" && pwd -P)
            rpath=$(patchelf --print-rpath "$binary" 2>/dev/null || true)
            search_path=""
            append_search_path() {
              local path_entry="$1"
              [ -n "$path_entry" ] || return 0
              if [ -z "$search_path" ]; then
                search_path="$path_entry"
              else
                search_path="$search_path:$path_entry"
              fi
            }

            IFS=: read -r -a rpath_entries <<< "$rpath"
            for entry in "''${rpath_entries[@]}"; do
              entry=$(printf '%s' "$entry" | awk -v origin="$origin" '{ gsub(/\$\{ORIGIN\}/, origin); gsub(/\$ORIGIN/, origin); print }')
              append_search_path "$entry"
            done
            append_search_path "''${LD_LIBRARY_PATH:-}"
            append_search_path "/lib"
            append_search_path "/usr/lib"
            append_search_path "/lib64"
            append_search_path "/usr/lib64"

            resolve_needed() {
              local needed_name="$1"
              if [ "''${needed_name#/}" != "$needed_name" ] && [ -e "$needed_name" ]; then
                readlink -f "$needed_name"
                return 0
              fi

              local entry candidate
              IFS=: read -r -a search_entries <<< "$search_path"
              for entry in "''${search_entries[@]}"; do
                [ -n "$entry" ] || continue
                candidate="$entry/$needed_name"
                if [ -e "$candidate" ]; then
                  readlink -f "$candidate"
                  return 0
                fi
              done

              return 1
            }

            while IFS= read -r needed_name; do
              [ -n "$needed_name" ] || continue
              if resolved=$(resolve_needed "$needed_name"); then
                printf '\t%s => %s (0x0000000000000000)\n' "$needed_name" "$resolved"
              else
                printf '\t%s => not found\n' "$needed_name"
              fi
            done <<< "$needed"
            EOF
            chmod 0755 target/.tauri/ldd
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
      apps = lib.optionalAttrs isLinux {
        tauri-desktop = {
          type = "app";
          program = "${wrappedTauriDesktop}/bin/app";
          meta.description = "Run the Macro Tauri desktop app";
        };
      };

      packages = {
        js-node-modules = nodeModules;
      }
      // lib.optionalAttrs isLinux {
        tauri-frontend = frontend;
        tauri-desktop = wrappedTauriDesktop;
        tauri-desktop-unwrapped = tauri.app;
        tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
      }
      // lib.optionalAttrs isX86_64Linux {
        tauri-desktop-appimage = tauriDesktopAppImage;
      }
      // lib.optionalAttrs isAarch64Darwin {
        tauri-frontend = frontend;
        tauri-desktop-dmg = tauriDesktopDmg;
        tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
      };
    };
}
