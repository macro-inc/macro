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
          config.allowUnfree = true;
          config.android_sdk.accept_license = true;
        };

        android_sdk =
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
          }).androidsdk;

        packages = with pkgs; [
          curl
          wget
          pkg-config
          xdg-utils

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

          gst_all_1.gstreamer
          gst_all_1.gst-plugins-base
          gst_all_1.gst-plugins-good
          gst_all_1.gst-plugins-bad

          (
            with fenix.packages.${system};
            combine [
              complete.rustc
              complete.rust-src
              complete.cargo
              complete.clippy
              complete.rustfmt
              complete.rust-analyzer
              targets.aarch64-linux-android.latest.rust-std
              targets.armv7-linux-androideabi.latest.rust-std
              targets.i686-linux-android.latest.rust-std
              targets.x86_64-linux-android.latest.rust-std
            ]
          )

          android_sdk
          jdk
        ];

        libraries = with pkgs; [
          gtk3
          libsoup_3
          webkitgtk_4_1
          cairo
          gdk-pixbuf
          glib
          dbus
          openssl
          librsvg
          lsb-release # without this single instance can fail on nixos
        ];
      in
      {
        devShell = pkgs.mkShell {
          buildInputs = packages ++ libraries;

          LD_LIBRARY_PATH = "${pkgs.lib.makeLibraryPath libraries}:$LD_LIBRARY_PATH";
          XDG_DATA_DIRS = "${pkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${pkgs.gsettings-desktop-schemas.name}:${pkgs.gtk3}/share/gsettings-schemas/${pkgs.gtk3.name}:$XDG_DATA_DIRS";
          ANDROID_HOME = "${android_sdk}/libexec/android-sdk";
          NDK_HOME = "${android_sdk}/libexec/android-sdk/ndk/26.3.11579264";
          GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${android_sdk}/libexec/android-sdk/build-tools/35.0.0/aapt2";
          GIO_MODULE_DIR = "${pkgs.glib-networking}/lib/gio/modules/";
        };
      }
    );
}
