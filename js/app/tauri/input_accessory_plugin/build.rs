fn main() {
    tauri_plugin::Builder::new(&[])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
