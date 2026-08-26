fn main() {
    tauri_plugin::Builder::new(&["watch_status"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
