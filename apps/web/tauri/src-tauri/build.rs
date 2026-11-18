use std::path::Path;

use bundle_identity::BundleManifest;

fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("ios") {
        // Android needs cdylib, so Cargo also emits an unused iOS dylib. CallKit's
        // Swift package is linked by Xcode into the final app, not by Cargo.
        // Defer only this symbol in the dylib; the shipped staticlib/app link
        // still requires Xcode to supply the real implementation.
        println!("cargo:rustc-link-arg-cdylib=-Wl,-U,_init_plugin_call_kit");
    }

    println!("cargo:rerun-if-changed=.macro-tauri-env");
    println!("cargo:rerun-if-changed={EMBEDDED_BUNDLE_MANIFEST}");
    println!("cargo:rerun-if-env-changed=MACRO_BUNDLE_UPDATE_BASE_URL");

    let contents = std::fs::read_to_string(".macro-tauri-env").unwrap_or_default();
    let raw_app_env = contents.trim();

    // A missing or blank file falls back to the safe `production` default;
    // any other content must be a valid environment name.
    let app_env = match raw_app_env {
        "" => "production",
        other => other,
    };

    match app_env {
        "development" | "production" => {
            println!("cargo:rustc-env=MACRO_TAURI_APP_ENV={app_env}");
        }
        other => {
            panic!(".macro-tauri-env must contain `development` or `production`, found `{other}`");
        }
    }

    // The embedded bundle's identity comes from its stamped manifest, so it
    // equals the OTA bundle deployed from the same commit. Release builds
    // refuse an unstamped bundle; development builds run without one.
    let manifest_path = Path::new(EMBEDDED_BUNDLE_MANIFEST);
    let (embedded_bundle_build, embedded_bundle_git_sha) =
        match BundleManifest::read_file(manifest_path) {
            Ok(manifest) => (
                manifest.bundle_build().get(),
                manifest.source().sha().to_string(),
            ),
            Err(error) if app_env == "production" => {
                panic!("{error}");
            }
            Err(error) => {
                println!("cargo:warning={error}; falling back to embedded bundle build 0");
                (0, String::new())
            }
        };
    println!("cargo:rustc-env=MACRO_EMBEDDED_BUNDLE_BUILD={embedded_bundle_build}");
    // Empty without a stamped manifest; the updater then sends no commit.
    println!("cargo:rustc-env=MACRO_EMBEDDED_BUNDLE_GIT_SHA={embedded_bundle_git_sha}");
    // Settings shows this as the app's build date. It stays fixed for the
    // binary; OTA bundles replace the JavaScript, not this value.
    let native_build_time_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock is before the Unix epoch")
        .as_millis();
    println!("cargo:rustc-env=MACRO_NATIVE_BUILD_TIME_MS={native_build_time_ms}");
    if let Ok(bundle_update_base_url) = std::env::var("MACRO_BUNDLE_UPDATE_BASE_URL") {
        let bundle_update_base_url = bundle_update_base_url.trim();
        if !bundle_update_base_url.is_empty() {
            println!("cargo:rustc-env=MACRO_BUNDLE_UPDATE_BASE_URL={bundle_update_base_url}");
        }
    }

    tauri_build::build()
}

const EMBEDDED_BUNDLE_MANIFEST: &str = "../../dist/bundle-manifest.json";
