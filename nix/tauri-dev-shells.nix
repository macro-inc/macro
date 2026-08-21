{ inputs, ... }:
{
  perSystem =
    { config, system, ... }:
    let
      inherit (inputs)
        nixpkgs
        fenix
        ;
      pkgs = import nixpkgs {
        inherit system;
      };
      lib = pkgs.lib;
      isLinux = pkgs.stdenv.isLinux;
      isX86_64Linux = system == "x86_64-linux";

      # Android Studio is unfree, and the composed SDK requires accepting the
      # Android SDK license. Keep this package set isolated from the default
      # shell so ordinary development does not pull in the mobile toolchain.
      tauriPkgs = import nixpkgs {
        inherit system;
        config.allowUnfree = true;
        config.android_sdk.accept_license = true;
      };

      androidSdk =
        (tauriPkgs.androidenv.composeAndroidPackages {
          platformVersions = [
            "34"
            "36"
          ];
          buildToolsVersions = [ "35.0.0" ];
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

      androidRustToolchain =
        with fenix.packages.${system};
        combine [
          complete.rustc
          complete.rust-src
          complete.cargo
          complete.clippy
          complete.rustfmt
          complete.rust-analyzer
          targets.wasm32-unknown-unknown.latest.rust-std
          targets.aarch64-linux-android.latest.rust-std
          targets.armv7-linux-androideabi.latest.rust-std
          targets.i686-linux-android.latest.rust-std
          targets.x86_64-linux-android.latest.rust-std
        ];

      tauriLinuxPackages = with tauriPkgs; [
        gst_all_1.gstreamer
        gst_all_1.gst-plugins-base
        gst_all_1.gst-plugins-good
        gst_all_1.gst-plugins-bad
        xdg-utils
      ];

      tauriLinuxLibraries = with tauriPkgs; [
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

      tauriLinuxShellHook = ''
        export LD_LIBRARY_PATH="${lib.makeLibraryPath tauriLinuxLibraries}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
        export XDG_DATA_DIRS="${tauriPkgs.gsettings-desktop-schemas}/share/gsettings-schemas/${tauriPkgs.gsettings-desktop-schemas.name}:${tauriPkgs.gtk3}/share/gsettings-schemas/${tauriPkgs.gtk3.name}''${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}"
      '';
    in
    {
      devShells =
        lib.optionalAttrs isLinux {
          tauri-linux = config.devShells.default.overrideAttrs (old: {
            buildInputs = (old.buildInputs or [ ]) ++ tauriLinuxPackages ++ tauriLinuxLibraries;
            shellHook = (old.shellHook or "") + tauriLinuxShellHook;
            GIO_MODULE_DIR = "${tauriPkgs.glib-networking}/lib/gio/modules/";
          });
        }
        // lib.optionalAttrs isX86_64Linux {
          tauri-android = config.devShells.default.overrideAttrs (old: {
            # Put the Android-capable toolchain before the default toolchain and
            # explicitly prepend it to PATH below so rustc can find every
            # Android target regardless of mkShell input ordering.
            buildInputs = [
              androidRustToolchain
              tauriPkgs.jdk
              androidSdk
              tauriPkgs.android-studio
            ]
            ++ (old.buildInputs or [ ]);
            shellHook = (old.shellHook or "") + ''
              export PATH="${androidRustToolchain}/bin:$PATH"
            '';
            ANDROID_HOME = "${androidSdk}/libexec/android-sdk";
            ANDROID_SDK_ROOT = "${androidSdk}/libexec/android-sdk";
            NDK_HOME = "${androidSdk}/libexec/android-sdk/ndk/26.3.11579264";
            GRADLE_OPTS = "-Dorg.gradle.project.android.aapt2FromMavenOverride=${androidSdk}/libexec/android-sdk/build-tools/35.0.0/aapt2";
          });
        };
    };
}
