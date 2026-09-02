fn main() {
    tauri_plugin::Builder::new(&["read_pasteboard_text", "stage_pasteboard_image"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
