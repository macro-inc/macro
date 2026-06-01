fn main() {
    println!("cargo:rerun-if-changed=.macro-tauri-env");

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

    tauri_build::build()
}
