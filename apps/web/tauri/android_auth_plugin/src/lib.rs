//! Browser authentication for Android. iOS retains its ASWebAuthenticationSession plugin.
#![deny(missing_docs)]

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

#[cfg(target_os = "android")]
mod android;

/// Registers the Android browser authentication command and native bridge.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("android-auth");
    #[cfg(target_os = "android")]
    let builder = builder
        .invoke_handler(tauri::generate_handler![android::authenticate])
        .setup(|app, api| {
            use tauri::Manager;
            let handle = api.register_android_plugin("com.macro.auth", "AuthPlugin")?;
            app.manage(android::Auth(handle));
            Ok(())
        });
    builder.build()
}
