const COMMANDS: &[&str] = &[
    "status",
    "request_permission",
    "set_device",
    "device_id",
    "sync",
    "clear",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .ios_path("ios")
        .android_path("android")
        .try_build()
        .unwrap();
}
