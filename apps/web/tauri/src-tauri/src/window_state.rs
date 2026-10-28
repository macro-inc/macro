//! Reopens the desktop window where the user left it.
//!
//! Without this, every launch creates the window at the `tauri.conf.json`
//! default size wherever the OS places it. The plugin restores the saved
//! geometry when the window is created and keeps it updated from move/resize
//! events; the saved position is only reused when it still lands on a
//! connected monitor.

use tauri::plugin::TauriPlugin;
use tauri::{AppHandle, Runtime};
use tauri_plugin_window_state::{AppHandleExt, Builder, StateFlags};

/// Decorations are fixed by `tauri.conf.json` and visibility is never toggled,
/// so only geometry is persisted. Restoring `VISIBLE` would also re-show and
/// refocus the window on every launch.
const FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new().with_state_flags(FLAGS).build()
}

/// The plugin only writes to disk on `RunEvent::Exit`. The native updater's
/// restart path exits the process before that event, so persist as soon as
/// quitting is requested; a later `Exit` write is harmless.
pub fn save<R: Runtime>(app: &AppHandle<R>) {
    if let Err(error) = app.save_window_state(FLAGS) {
        tracing::warn!(error = ?error, "failed to save window state");
    }
}
