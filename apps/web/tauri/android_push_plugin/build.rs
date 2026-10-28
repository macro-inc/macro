fn main() {
    tauri_plugin::Builder::new(&[
        "check_permissions",
        "request_permissions",
        "register",
        "configure",
        "watch",
        "unwatch",
        "acknowledge",
    ])
    .android_path("android")
    .build();
}
