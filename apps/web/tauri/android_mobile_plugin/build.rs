fn main() {
    tauri_plugin::Builder::new(&[
        "register_listener",
        "remove_listener",
        "getInsets",
        "getPendingShares",
        "clearShares",
        "stageClipboardImage",
        "beginExport",
        "appendExport",
        "finishExport",
        "discardExport",
    ])
    .android_path("android")
    .build();
}
