fn main() {
    tauri_plugin::Builder::new(&["get_voip_token", "end_active_call"])
        .ios_path("ios")
        .try_build()
        .unwrap();
}
