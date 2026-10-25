//! Native iOS save and share adapters for already-authorized file bytes.
#![deny(missing_docs)]

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_file_export);

/// Registers the iOS file export bridge.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    let builder = Builder::new("file-export");
    #[cfg(target_os = "ios")]
    let builder = builder.setup(|_app, api| {
        api.register_ios_plugin(init_plugin_file_export)?;
        Ok(())
    });
    builder.build()
}
