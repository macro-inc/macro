{
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    fenix.url = "github:nix-community/fenix";
    fenix.inputs.nixpkgs.follows = "nixpkgs";
    nixpkgs-biome.url = "github:NixOS/nixpkgs/af70ad706db919d644586e8f95c1d8d3d0a1ac56";
  };

  outputs =
    {
      self,
      nixpkgs,
      nixpkgs-biome,
      flake-utils,
      fenix,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = import nixpkgs {
          system = system;
          config.allowUnfree = true;
          config.android_sdk.accept_license = true;
        };
        pkgs-biome = nixpkgs-biome.legacyPackages.${system};

        isDarwin = pkgs.stdenv.isDarwin;
        isLinux = pkgs.stdenv.isLinux;

        android_sdk = pkgs.lib.optionalAttrs isLinux (
          (pkgs.androidenv.composeAndroidPackages {
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

        basePackages = with pkgs; [
          curl
          wget
          pkg-config
          just
          bun
          pkgs-biome.biome
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

        linuxPackages = with pkgs; [
          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad
          jdk
        ];

        packages = basePackages ++ pkgs.lib.optionals isLinux (linuxPackages ++ [ android_sdk ]);

        linuxLibraries = with pkgs; [
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

        darwinLibraries = with pkgs; [
          openssl
          libiconv
        ];

        libraries = if isDarwin then darwinLibraries else linuxLibraries;
      in
      {
        devShell = pkgs.mkShell (
          {
            buildInputs = packages ++ libraries;
            PKG_CONFIG_PATH = "${pkgs.openssl.dev}/lib/pkgconfig";
          }
          // pkgs.lib.optionalAttrs isLinux {
            LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}:$LD_LIBRARY_PATH";
            XDG_DATA_DIRS = "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS";
            ANDROID_HOME = "${android_sdk}/libexec/android-sdk";
            NDK_HOME = "${android_sdk}/libexec/android-sdk/ndk/26.3.11579264";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${android_sdk}/libexec/android-sdk/build-tools/35.0.0/aapt2";
            GIO_MODULE_DIR = "${pkgs.glib-networking}/lib/gio/modules/";
          }
        );
      }
    );
}
