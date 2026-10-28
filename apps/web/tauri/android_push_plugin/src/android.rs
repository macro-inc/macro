use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct Push<R: Runtime>(pub PluginHandle<R>);

macro_rules! command {
    ($name:ident, $native:literal) => {
        #[tauri::command]
        pub(crate) async fn $name<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
            app.state::<Push<R>>()
                .0
                .run_mobile_plugin_async($native, ())
                .await
                .map_err(|error| error.to_string())
        }
    };
}
command!(check_permissions, "checkPermissions");
command!(request_permissions, "requestPermissions");
command!(register, "register");
command!(unwatch, "unwatch");

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AcknowledgeArgs {
    delivery_id: String,
}

#[tauri::command]
pub(crate) async fn acknowledge<R: Runtime>(
    app: AppHandle<R>,
    payload: AcknowledgeArgs,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("acknowledge", payload)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConfigureArgs {
    recipient_id: Option<String>,
}

#[tauri::command]
pub(crate) async fn configure<R: Runtime>(
    app: AppHandle<R>,
    payload: ConfigureArgs,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("configure", payload)
        .await
        .map_err(|error| error.to_string())
}

#[derive(Serialize)]
struct WatchArgs {
    channel: Channel<Value>,
}

#[tauri::command]
pub(crate) async fn watch<R: Runtime>(
    app: AppHandle<R>,
    channel: Channel<Value>,
) -> Result<(), String> {
    app.state::<Push<R>>()
        .0
        .run_mobile_plugin_async("watch", WatchArgs { channel })
        .await
        .map_err(|error| error.to_string())
}
