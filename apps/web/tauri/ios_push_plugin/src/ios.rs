use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct Push<R: Runtime>(pub PluginHandle<R>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigureArgs {
    recipient_id: Option<String>,
}

#[tauri::command]
pub(crate) async fn configure_recipient<R: Runtime>(
    app: AppHandle<R>,
    payload: ConfigureArgs,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("configureRecipient", payload)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn check_permissions<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("checkPermissions", ())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn request_permissions<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("requestPermissions", ())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn check_registration_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Value, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("checkRegistrationStatus", ())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn register_for_remote_notifications<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Value, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("registerForRemoteNotifications", ())
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WatchArgs {
    channel: Channel<Value>,
    launch_aware: bool,
}

#[tauri::command]
pub(crate) async fn watch_notifications<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel<Value>,
    launch_aware: Option<bool>,
) -> Result<Value, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async(
            "watchNotifications",
            WatchArgs {
                channel,
                launch_aware: launch_aware.unwrap_or(false),
            },
        )
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn unwatch_notifications<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("unwatchNotifications", ())
        .await
        .map_err(|error| error.to_string())
}

#[derive(Deserialize)]
struct PendingResult {
    event: Option<Value>,
}

#[tauri::command]
pub(crate) async fn get_pending_notification<R: Runtime>(
    app: AppHandle<R>,
) -> Result<Option<Value>, String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async::<PendingResult>("getPendingNotification", ())
        .await
        .map(|result| result.event)
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AcknowledgeArgs {
    delivery_id: String,
}

#[tauri::command]
pub(crate) async fn acknowledge_notification<R: Runtime>(
    app: AppHandle<R>,
    delivery_id: String,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("acknowledgeNotification", AcknowledgeArgs { delivery_id })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn clear_pending_notification<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("clearPendingNotification", ())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn release_notification_cover<R: Runtime>(
    app: AppHandle<R>,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("releaseNotificationCover", ())
        .await
        .map_err(|error| error.to_string())
}
