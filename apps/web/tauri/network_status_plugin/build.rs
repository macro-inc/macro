fn main() {
    tauri_plugin::Builder::new(&["get_status", "watch_status"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
