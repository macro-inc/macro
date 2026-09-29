//! Android window, navigation, and file adapters for the shared web client.
#![deny(missing_docs)]

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

/// Registers native Android commands; the web client retains composer policy.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-mobile")
        .setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("com.macro.mobile", "MobilePlugin")?;
            Ok(())
        })
        .build()
}
