//! Tauri plugin exposing native iOS network-path status.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_network_status);

/// Builds the `network-status` Tauri plugin.
///
/// On iOS this registers a Swift `NWPathMonitor` adapter. Other targets keep
/// the plugin inert and continue using their existing browser connectivity
/// integration.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("network-status")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_network_status)?;
            Ok(())
        })
        .build()
}
