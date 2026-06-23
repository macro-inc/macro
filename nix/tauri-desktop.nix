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
      nixAppimage = inputs."nix-appimage";
      pkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
      };
      inherit (pkgs) lib;
      isLinux = pkgs.stdenv.hostPlatform.isLinux;

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

      tauriDesktopAppImage = nixAppimage.lib.${system}.mkAppImage {
        program = lib.getExe wrappedTauriDesktop;
        pname = "macro-tauri-desktop";
        name = "Macro-${appVersion}-${system}.AppImage";
      };
    in
    {
      apps = lib.optionalAttrs isLinux {
        tauri-desktop = {
          type = "app";
          program = "${wrappedTauriDesktop}/bin/app";
          meta.description = "Run the Macro Tauri desktop app";
        };
      };

      packages = lib.optionalAttrs isLinux {
        tauri-frontend = frontend;
        tauri-desktop = wrappedTauriDesktop;
        tauri-desktop-appimage = tauriDesktopAppImage;
        tauri-desktop-unwrapped = tauri.app;
        tauri-desktop-cargo-artifacts = tauri.cargoArtifacts;
      };
    };
}
