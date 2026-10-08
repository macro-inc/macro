//! Tauri plugin that integrates iOS CallKit and PushKit for a native
//! incoming-call UI.
//!
//! On iOS the plugin registers a Swift `CXProvider`/`PKPushRegistry`
//! implementation (`init_plugin_call_kit`) that displays the system
//! incoming-call screen, handles answer/end actions, and delivers VoIP push
//! tokens to the JS layer. Android uses self-managed Telecom and native LiveKit.
//! Desktop platforms have no native call integration.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_call_kit);

#[cfg(target_os = "android")]
mod android;

/// Builds and returns the `call-kit` Tauri plugin.
///
/// On iOS, registers the Swift `CallKitPlugin` via `init_plugin_call_kit`,
/// which wires up `CXProvider`, `PKPushRegistry`, and the Tauri event bridge.
/// On Android, registers the Kotlin Telecom and LiveKit bridge.
///
/// Pass the result directly to [`tauri::Builder::plugin`].
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let builder = tauri::plugin::Builder::new("call-kit");
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        android::get_voip_token,
        android::end_active_call,
        android::get_pending_answered_call,
        android::watch_call_answered,
        android::watch_call_ended,
        android::watch_connection_state,
        android::watch_drawer_opened,
        android::watch_participant_identities,
        android::get_active_call_state,
        android::start_outgoing_call,
        android::prepare_join,
        android::abort_join,
        android::set_video_enabled,
        android::set_video_overlay_mode,
        android::set_call_drawer_channel_title,
        android::set_call_drawer_theme,
        android::set_participant_display_name,
        android::switch_camera
    ]);
    builder
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            _api.register_ios_plugin(init_plugin_call_kit)?;
            #[cfg(target_os = "android")]
            {
                use tauri::Manager;
                let handle = _api.register_android_plugin("com.macro.call", "CallPlugin")?;
                _app.manage(android::Calls(handle));
            }
            Ok(())
        })
        .build()
}
