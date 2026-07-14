fn main() {
    tauri_plugin::Builder::new(&["stage_pasteboard_image"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
