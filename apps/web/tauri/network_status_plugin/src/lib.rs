//! Tauri plugin exposing native mobile network-path status.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_network_status);

#[cfg(target_os = "android")]
mod android;

/// Builds the native mobile `network-status` Tauri plugin.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("network-status");
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![android::watch_status]);
    builder
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_network_status)?;
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle =
                    _api.register_android_plugin("com.macro.network", "NetworkStatusPlugin")?;
                _app.manage(android::NetworkStatus(handle));
            }
            Ok(())
        })
        .build()
}
