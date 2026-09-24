fn main() {
    tauri_plugin::Builder::new(&["authenticate"])
        .android_path("android")
        .build();
}
