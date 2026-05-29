fn main() {
    tauri_plugin::Builder::new(&["pick_photo_library_images"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
