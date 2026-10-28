//! Suppresses the native iOS text-selection edit menu (Copy | Look Up |
//! Share …) on demand, so it doesn't stack on top of the in-app selection
//! popup. The frontend toggles suppression while its own popup is showing.
#![deny(missing_docs)]

#[cfg(target_os = "ios")]
use serde::Serialize;
use tauri::{
    AppHandle, Manager, Runtime, command,
    plugin::{Builder, PluginHandle, TauriPlugin},
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_edit_menu);

#[cfg(target_os = "ios")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetNativeMenuSuppressedPayload {
    suppressed: bool,
}

/// Access to the edit-menu plugin.
pub struct EditMenu<R: Runtime>(PluginHandle<R>);

impl<R: Runtime> EditMenu<R> {
    #[cfg(target_os = "ios")]
    fn set_native_menu_suppressed(&self, suppressed: bool) -> Result<(), String> {
        self.0
            .run_mobile_plugin::<()>(
                "setNativeMenuSuppressed",
                SetNativeMenuSuppressedPayload { suppressed },
            )
            .map_err(|error| error.to_string())
    }
}

/// Extension trait to access the edit-menu plugin from an app handle.
pub trait EditMenuExt<R: Runtime> {
    /// Returns the edit-menu plugin handle.
    fn edit_menu(&self) -> &EditMenu<R>;
}

impl<R: Runtime, T: Manager<R>> EditMenuExt<R> for T {
    fn edit_menu(&self) -> &EditMenu<R> {
        self.state::<EditMenu<R>>().inner()
    }
}

#[command]
async fn set_native_menu_suppressed<R: Runtime>(
    app: AppHandle<R>,
    suppressed: bool,
) -> Result<(), String> {
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, suppressed);
        Ok(())
    }

    #[cfg(target_os = "ios")]
    {
        app.edit_menu().set_native_menu_suppressed(suppressed)
    }
}

/// Initializes the edit-menu plugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("edit-menu")
        .invoke_handler(tauri::generate_handler![set_native_menu_suppressed])
        .setup(|_app, _api| {
            #[cfg(target_os = "ios")]
            {
                let handle = _api.register_ios_plugin(init_plugin_edit_menu)?;
                _app.manage(EditMenu(handle));
            }
            Ok(())
        })
        .build()
}
