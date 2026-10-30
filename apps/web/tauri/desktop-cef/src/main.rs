#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// CEF re-launches this binary for its renderer, GPU, and utility processes;
// the entry point runs those and returns before the app starts.
#[cfg_attr(target_os = "macos", tauri_runtime_cef::cef_entry_point)]
fn main() {
    #[cfg(target_os = "macos")]
    app_lib::run_with(tauri::Builder::default().runtime(tauri_runtime_cef::Cef::default()));
    #[cfg(not(target_os = "macos"))]
    compile_error!("desktop-cef is the macOS build; other platforms build ../src-tauri");
}
