fn main() {
    tauri_plugin::Builder::new(&[
        "available",
        "beginExport",
        "appendExport",
        "finishExport",
        "discardExport",
    ])
    .ios_path("ios")
    .build();
}
