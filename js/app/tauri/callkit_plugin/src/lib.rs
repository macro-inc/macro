#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_call_kit);

pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("call-kit")
        .setup(|app, _api| {
            #[cfg(target_os = "ios")]
            init_plugin_call_kit(app.handle(), _api);
            Ok(())
        })
        .build()
}
