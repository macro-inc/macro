//! Tauri plugin that integrates iOS CallKit and PushKit for a native
//! incoming-call UI.
//!
//! On iOS the plugin registers a Swift `CXProvider`/`PKPushRegistry`
//! implementation (`init_plugin_call_kit`) that displays the system
//! incoming-call screen, handles answer/end actions, and delivers VoIP push
//! tokens to the JS layer. On all other platforms the plugin is a no-op.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_call_kit);

/// Builds and returns the `call-kit` Tauri plugin.
///
/// On iOS, registers the Swift `CallKitPlugin` via `init_plugin_call_kit`,
/// which wires up `CXProvider`, `PKPushRegistry`, and the Tauri event bridge.
/// On all other platforms the setup closure is a no-op.
///
/// Pass the result directly to [`tauri::Builder::plugin`].
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("call-kit")
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_call_kit)?;
            Ok(())
        })
        .build()
}
