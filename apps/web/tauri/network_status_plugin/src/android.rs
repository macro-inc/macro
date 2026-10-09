use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct NetworkStatus<R: Runtime>(pub PluginHandle<R>);

#[derive(Serialize)]
struct WatchStatusArgs {
    channel: Channel,
}

#[tauri::command]
pub(crate) async fn watch_status<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel,
) -> Result<(), String> {
    app.state::<NetworkStatus<R>>()
        .0
        .run_mobile_plugin_async("watchStatus", WatchStatusArgs { channel })
        .await
        .map_err(|error| error.to_string())
}
