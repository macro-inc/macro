//! Tauri plugin that monitors the places named by location-triggered
//! routines with OS geofencing and reports crossings to the
//! scheduled-action service from native code, so reports arrive while the app
//! is closed.
//!
//! Commands have no Rust handlers: Tauri routes `plugin:geofence|<command>` to
//! the Swift or Kotlin method of the same name in lower camel case.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_geofence);

/// Builds the native mobile `geofence` Tauri plugin.
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("geofence")
        // Lets OTA web bundles tell binaries with this plugin from older ones.
        .js_init_script(include_str!("init.js"))
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_geofence)?;
            #[cfg(target_os = "android")]
            _api.register_android_plugin("com.macro.geofence", "GeofencePlugin")?;
            Ok(())
        })
        .build()
}
