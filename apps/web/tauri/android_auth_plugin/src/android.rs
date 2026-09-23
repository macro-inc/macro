use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Runtime, plugin::PluginHandle};

pub(crate) struct Auth<R: Runtime>(pub PluginHandle<R>);

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthenticateArgs {
    auth_url: String,
    callback_url: String,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AuthResult {
    success: bool,
    token: Option<String>,
    error: Option<String>,
}

#[tauri::command]
pub(crate) async fn authenticate<R: Runtime>(
    app: AppHandle<R>,
    payload: AuthenticateArgs,
) -> Result<AuthResult, String> {
    app.state::<Auth<R>>()
        .0
        .run_mobile_plugin("authenticate", payload)
        .map_err(|error| error.to_string())
}
