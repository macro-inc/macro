fn main() {
    println!("cargo:rerun-if-changed=.macro-tauri-env");
    println!("cargo:rerun-if-changed=../../packages/app/dist/bundle-manifest.json");
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

    let embedded_bundle_build = match read_embedded_bundle_build() {
        Ok(bundle_build) => bundle_build,
        Err(error) if app_env == "production" => {
            panic!("{error}");
        }
        Err(error) => {
            println!("cargo:warning={error}; falling back to embedded bundle build 0");
            0
        }
    };
    println!("cargo:rustc-env=MACRO_EMBEDDED_BUNDLE_BUILD={embedded_bundle_build}");
    if let Ok(bundle_update_base_url) = std::env::var("MACRO_BUNDLE_UPDATE_BASE_URL") {
        let bundle_update_base_url = bundle_update_base_url.trim();
        if !bundle_update_base_url.is_empty() {
            println!("cargo:rustc-env=MACRO_BUNDLE_UPDATE_BASE_URL={bundle_update_base_url}");
        }
    }

    tauri_build::build()
}

fn read_embedded_bundle_build() -> Result<u64, String> {
    let path = "../../packages/app/dist/bundle-manifest.json";
    let contents =
        std::fs::read_to_string(path).map_err(|e| format!("failed to read {path}: {e}"))?;
    let manifest = serde_json::from_str::<serde_json::Value>(&contents)
        .map_err(|e| format!("failed to parse {path}: {e}"))?;
    manifest
        .get("bundleBuild")
        .and_then(|value| value.as_u64())
        .ok_or_else(|| format!("{path} missing unsigned integer bundleBuild"))
}
