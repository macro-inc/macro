//! Android remote notifications. iOS retains its existing push plugin.
#![deny(missing_docs)]

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

#[cfg(target_os = "android")]
mod android;

/// Register the Android Firebase receiver bridge.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("android-push");
    #[cfg(target_os = "android")]
    let builder = builder
        .invoke_handler(tauri::generate_handler![
            android::check_permissions,
            android::request_permissions,
            android::register,
            android::configure,
            android::watch,
            android::unwatch,
            android::acknowledge,
        ])
        .setup(|app, api| {
            use tauri::Manager;
            let handle = api.register_android_plugin("com.macro.push", "PushPlugin")?;
            app.manage(android::Push(handle));
            Ok(())
        });
    builder.build()
}
