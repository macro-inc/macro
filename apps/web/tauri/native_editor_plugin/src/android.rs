use crate::generated::*;
use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct NativeEditor<R: Runtime>(pub PluginHandle<R>);

#[derive(Serialize)]
struct Request<T> {
    request: T,
}
#[derive(Serialize)]
struct BeginAccount {
    request: AccountRequest,
    channel: Channel<SurfaceEvent>,
}

#[tauri::command]
pub(crate) async fn begin_account<R: Runtime>(
    app: AppHandle<R>,
    request: AccountRequest,
    channel: Channel<SurfaceEvent>,
) -> Result<AccountReply, String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("beginAccount", BeginAccount { request, channel })
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) async fn create<R: Runtime>(
    app: AppHandle<R>,
    request: CreateRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("create", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn mount<R: Runtime>(
    app: AppHandle<R>,
    request: MountRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("mount", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn layout<R: Runtime>(
    app: AppHandle<R>,
    request: LayoutRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("layout", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn focus<R: Runtime>(
    app: AppHandle<R>,
    request: FocusRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("focus", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn permissions<R: Runtime>(
    app: AppHandle<R>,
    request: PermissionRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("permissions", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn token_result<R: Runtime>(
    app: AppHandle<R>,
    request: TokenResultRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("tokenResult", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn action<R: Runtime>(
    app: AppHandle<R>,
    request: ActionRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("action", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn query<R: Runtime>(
    app: AppHandle<R>,
    request: QueryRequest,
) -> Result<QueryReply, String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("query", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn lifecycle<R: Runtime>(
    app: AppHandle<R>,
    request: LifecycleRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("lifecycle", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn unmount<R: Runtime>(
    app: AppHandle<R>,
    request: UnmountRequest,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("unmount", Request { request })
        .await
        .map_err(|error| error.to_string())
}
#[tauri::command]
pub(crate) async fn stop<R: Runtime>(
    app: AppHandle<R>,
    request: SurfaceScope,
) -> Result<(), String> {
    app.state::<NativeEditor<R>>()
        .0
        .run_mobile_plugin_async("stop", Request { request })
        .await
        .map_err(|error| error.to_string())
}
