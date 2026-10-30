//! iOS remote notifications with a durable, acknowledged navigation handoff.
#![deny(missing_docs)]

use tauri::{
    Runtime,
    plugin::{Builder, TauriPlugin},
};

#[cfg(target_os = "ios")]
mod ios;

/// Register the iOS APNs bridge under the existing notifications namespace.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("notifications");
    #[cfg(target_os = "ios")]
    let builder = builder
        .js_init_script("window.__MACRO_IOS_NOTIFICATION_LAUNCH__ = true;")
        .invoke_handler(tauri::generate_handler![
            ios::check_permissions,
            ios::request_permissions,
            ios::check_registration_status,
            ios::register_for_remote_notifications,
            ios::watch_notifications,
            ios::unwatch_notifications,
            ios::get_pending_notification,
            ios::acknowledge_notification,
            ios::clear_pending_notification,
            ios::release_notification_cover,
            ios::configure_recipient,
        ])
        .setup(|app, api| {
            use tauri::Manager;
            tauri::ios_plugin_binding!(init_plugin_notifications);
            app.manage(ios::Push(
                api.register_ios_plugin(init_plugin_notifications)?,
            ));
            Ok(())
        });
    builder.build()
}
