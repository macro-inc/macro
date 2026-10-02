use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, ipc::Channel, plugin::PluginHandle};

pub(crate) struct Calls<R: Runtime>(pub PluginHandle<R>);

macro_rules! command {
    ($name:ident, $native:literal) => {
        #[tauri::command]
        pub(crate) async fn $name<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
            app.state::<Calls<R>>()
                .0
                .run_mobile_plugin_async($native, ())
                .await
                .map_err(|e| e.to_string())
        }
    };
}
command!(get_voip_token, "getVoipToken");
command!(end_active_call, "endActiveCall");
command!(get_pending_answered_call, "getPendingAnsweredCall");
command!(get_active_call_state, "getActiveCallState");
command!(switch_camera, "switchCamera");

#[derive(Serialize)]
struct WatchArgs {
    channel: Channel<Value>,
}
macro_rules! watch {
    ($name:ident, $native:literal) => {
        #[tauri::command]
        pub(crate) async fn $name<R: Runtime>(
            app: AppHandle<R>,
            channel: Channel<Value>,
        ) -> Result<(), String> {
            app.state::<Calls<R>>()
                .0
                .run_mobile_plugin_async($native, WatchArgs { channel })
                .await
                .map_err(|e| e.to_string())
        }
    };
}
watch!(watch_call_answered, "watchCallAnswered");
watch!(watch_call_ended, "watchCallEnded");
watch!(watch_connection_state, "watchConnectionState");
watch!(watch_drawer_opened, "watchDrawerOpened");
watch!(watch_participant_identities, "watchParticipantIdentities");

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StartOutgoingCallArgs {
    channel_id: String,
    call_id: String,
    channel_title: Option<String>,
    caller_name: Option<String>,
    server_url: String,
    token: String,
    join_lease: Option<String>,
}

#[tauri::command]
pub(crate) async fn start_outgoing_call<R: Runtime>(
    app: AppHandle<R>,
    channel_id: String,
    call_id: String,
    channel_title: Option<String>,
    caller_name: Option<String>,
    server_url: String,
    token: String,
    join_lease: Option<String>,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async(
            "startOutgoingCall",
            StartOutgoingCallArgs {
                channel_id,
                call_id,
                channel_title,
                caller_name,
                server_url,
                token,
                join_lease,
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetVideoEnabledArgs {
    enabled: bool,
}

#[tauri::command]
pub(crate) async fn set_video_enabled<R: Runtime>(
    app: AppHandle<R>,
    enabled: bool,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async("setVideoEnabled", SetVideoEnabledArgs { enabled })
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetVideoOverlayModeArgs {
    mode: String,
}

#[tauri::command]
pub(crate) async fn set_video_overlay_mode<R: Runtime>(
    app: AppHandle<R>,
    mode: String,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async("setVideoOverlayMode", SetVideoOverlayModeArgs { mode })
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetCallDrawerChannelTitleArgs {
    channel_title: Option<String>,
}

#[tauri::command]
pub(crate) async fn set_call_drawer_channel_title<R: Runtime>(
    app: AppHandle<R>,
    channel_title: Option<String>,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async(
            "setCallDrawerChannelTitle",
            SetCallDrawerChannelTitleArgs { channel_title },
        )
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetCallDrawerThemeArgs {
    theme: Value,
}

#[tauri::command]
pub(crate) async fn set_call_drawer_theme<R: Runtime>(
    app: AppHandle<R>,
    theme: Value,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async("setCallDrawerTheme", SetCallDrawerThemeArgs { theme })
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SetParticipantDisplayNameArgs {
    identity: String,
    display_name: Option<String>,
}

#[tauri::command]
pub(crate) async fn set_participant_display_name<R: Runtime>(
    app: AppHandle<R>,
    identity: String,
    display_name: Option<String>,
) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async(
            "setParticipantDisplayName",
            SetParticipantDisplayNameArgs {
                identity,
                display_name,
            },
        )
        .await
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PrepareJoinArgs {
    channel_id: String,
}
#[tauri::command]
pub(crate) async fn prepare_join<R: Runtime>(
    app: AppHandle<R>,
    channel_id: String,
) -> Result<Value, String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async("prepareJoin", PrepareJoinArgs { channel_id })
        .await
        .map_err(|e| e.to_string())
}
#[derive(Serialize)]
struct AbortJoinArgs {
    lease: String,
}
#[tauri::command]
pub(crate) async fn abort_join<R: Runtime>(app: AppHandle<R>, lease: String) -> Result<(), String> {
    app.state::<Calls<R>>()
        .0
        .run_mobile_plugin_async("abortJoin", AbortJoinArgs { lease })
        .await
        .map_err(|e| e.to_string())
}
