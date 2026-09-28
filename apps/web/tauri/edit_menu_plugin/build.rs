fn main() {
    tauri_plugin::Builder::new(&["set_native_menu_suppressed"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
