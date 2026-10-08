//! Desktop release updates. Native installation is independent of frontend OTA.

mod state;

use state::Status;
use tauri::{AppHandle, Runtime};

#[cfg(desktop)]
mod desktop;
#[cfg(desktop)]
pub use desktop::{on_exit_requested, setup};

#[tauri::command]
pub fn get_native_update_status<R: Runtime>(app: AppHandle<R>) -> Status {
    #[cfg(desktop)]
    return desktop::status(&app);
    #[cfg(mobile)]
    {
        let _ = app;
        Status::Disabled
    }
}

#[tauri::command]
pub fn restart_native_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(desktop)]
    return desktop::restart(&app);
    #[cfg(mobile)]
    {
        let _ = app;
        Err("Native updates are managed by the app store".into())
    }
}
