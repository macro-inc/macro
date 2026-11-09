//! Projects UIKit layout traits into the shared mobile UI.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_layout);

/// Builds the iOS layout observer plugin.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("layout")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_layout)?;
            Ok(())
        })
        .build()
}
