{ inputs, ... }:
{
  perSystem =
    { system, ... }:
    let
      inherit (inputs)
        nixpkgs
        fenix
        ;
      pkgs = import nixpkgs {
        system = system;
      };
      isDarwin = pkgs.stdenv.isDarwin;
      isLinux = pkgs.stdenv.isLinux;

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

      jsRustComponents = with fenix.packages.${system}; [
        complete.rustc
        complete.rust-src
        complete.cargo
        complete.clippy
        complete.rustfmt
        complete.rust-analyzer
      ];

      jsRustToolchain = with fenix.packages.${system}; combine jsRustComponents;
      jsAndroidRustToolchain =
        with fenix.packages.${system};
        combine (
          jsRustComponents
          ++ [
            targets.aarch64-linux-android.latest.rust-std
            targets.armv7-linux-androideabi.latest.rust-std
            targets.i686-linux-android.latest.rust-std
            targets.x86_64-linux-android.latest.rust-std
          ]
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
      ];

      jsLinuxPackages = with jsPkgs; [
        gst_all_1.gstreamer
        gst_all_1.gst-plugins-base
        gst_all_1.gst-plugins-good
        gst_all_1.gst-plugins-bad
        xdg-utils
      ];

      jsPackages = jsBasePackages ++ [ jsRustToolchain ] ++ pkgs.lib.optionals isLinux jsLinuxPackages;
      jsAndroidPackages =
        jsBasePackages
        ++ [ jsAndroidRustToolchain ]
        ++ pkgs.lib.optionals isLinux (
          jsLinuxPackages
          ++ [
            jsPkgs.jdk
            android_sdk
          ]
        );

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
      jsLinuxShellHook = ''
        export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath jsLibraries}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        export XDG_DATA_DIRS="${jsPkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${jsPkgs.gsettings-desktop-schemas.name}:${jsPkgs.gtk3}/share/gsettings-schemas/${jsPkgs.gtk3.name}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
      '';
    in
    {
      devShells = {
        js-app = jsPkgs.mkShell (
          {
            buildInputs = jsPackages ++ jsLibraries;
            PKG_CONFIG_PATH = "${jsPkgs.openssl.dev}/lib/pkgconfig";
          }
          // pkgs.lib.optionalAttrs isLinux {
            shellHook = jsLinuxShellHook;
            GIO_MODULE_DIR = "${jsPkgs.glib-networking}/lib/gio/modules/";
          }
        );
      }
      // pkgs.lib.optionalAttrs isLinux {
        js-app-android = jsPkgs.mkShell {
          buildInputs = jsAndroidPackages ++ jsLibraries;
          PKG_CONFIG_PATH = "${jsPkgs.openssl.dev}/lib/pkgconfig";
          shellHook = jsLinuxShellHook;
          ANDROID_HOME = "${android_sdk}/libexec/android-sdk";
          NDK_HOME = "${android_sdk}/libexec/android-sdk/ndk/26.3.11579264";
          GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${android_sdk}/libexec/android-sdk/build-tools/35.0.0/aapt2";
          GIO_MODULE_DIR = "${jsPkgs.glib-networking}/lib/gio/modules/";
        };
      };
    };
}
