fn main() {
    println!("cargo:rerun-if-changed=.macro-tauri-env");
    println!("cargo:rerun-if-changed=../../packages/app/dist/bundle-manifest.json");

    let contents = std::fs::read_to_string(".macro-tauri-env").unwrap_or_default();

    // A missing or blank file falls back to the safe `production` default;
    // any other content must be a valid environment name.
    let app_env = match contents.trim() {
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

    let embedded_bundle_build =
        std::fs::read_to_string("../../packages/app/dist/bundle-manifest.json")
            .ok()
            .and_then(|contents| serde_json::from_str::<serde_json::Value>(&contents).ok())
            .and_then(|manifest| manifest.get("bundleBuild").and_then(|value| value.as_u64()))
            .unwrap_or(0);
    println!("cargo:rustc-env=MACRO_EMBEDDED_BUNDLE_BUILD={embedded_bundle_build}");

    tauri_build::build()
}
