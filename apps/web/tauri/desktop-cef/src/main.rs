#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// CEF re-launches this binary for its renderer, GPU, and utility processes;
// the entry point runs those and returns before the app starts.
#[cfg_attr(target_os = "macos", tauri_runtime_cef::cef_entry_point)]
fn main() {
    #[cfg(target_os = "macos")]
    app_lib::run_with(
        tauri::Builder::default().runtime(tauri_runtime_cef::Cef::default()),
        configure_window,
    );
    #[cfg(not(target_os = "macos"))]
    compile_error!("desktop-cef is the macOS build; other platforms build ../src-tauri");
}

/// Alloy style has no screen picker, so screen sharing is granted only after
/// the user picks a source in the app's own picker.
#[cfg(target_os = "macos")]
fn configure_window<'a>(
    window: tauri::WebviewWindowBuilder<'a, app_lib::AppRuntime, tauri::App<app_lib::AppRuntime>>,
) -> tauri::WebviewWindowBuilder<'a, app_lib::AppRuntime, tauri::App<app_lib::AppRuntime>> {
    use tauri_runtime_cef::WebviewWindowBuilderCefExt;
    window.on_desktop_capture_request(app_lib::screen_capture::take_screen_capture_grant)
}
