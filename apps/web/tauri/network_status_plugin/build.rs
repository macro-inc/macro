fn main() {
    tauri_plugin::Builder::new(&["watch_status"])
        .ios_path("ios")
        .android_path("android")
        .try_build()
        .unwrap();
}
