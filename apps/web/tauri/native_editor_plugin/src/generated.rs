// Generated from schema/bridge.schema.json; do not edit.
// Example code that deserializes and serializes the model.
// extern crate serde;
// #[macro_use]
// extern crate serde_derive;
// extern crate serde_json;
//
// use generated_module::NativeBridgeTypes;
//
// fn main() {
//     let json = r#"{"answer": 42}"#;
//     let model: NativeBridgeTypes = serde_json::from_str(&json).unwrap();
// }

use serde::{Deserialize, Serialize};

/// Source of truth for the Android editor bridge. The root is a type catalog; commands carry
/// their named request, never this catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeBridgeTypes {
    pub account_reply: AccountReply,

    pub account_request: AccountRequest,

    pub action_request: ActionRequest,

    pub create_request: CreateRequest,

    pub focus_request: FocusRequest,

    pub layout_request: LayoutRequest,

    pub lifecycle_request: LifecycleRequest,

    pub mount_request: MountRequest,

    pub permission_request: PermissionRequest,

    pub query_reply: QueryReply,

    pub query_request: QueryRequest,

    pub surface_event: SurfaceEvent,

    pub surface_permissions: SurfacePermissions,

    pub surface_scope: SurfaceScope,

    pub token_result_request: TokenResultRequest,

    pub unmount_request: UnmountRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountReply {
    pub account_generation: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountRequest {
    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionRequest {
    pub kind: ActionRequestKind,

    pub model_generation: i64,

    pub name: String,

    pub payload_json: Option<String>,

    pub revision: Option<i64>,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionRequestKind {
    Application,

    Command,

    #[serde(rename = "setState")]
    SetState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceScope {
    pub account_generation: i64,

    pub surface_generation: i64,

    pub surface_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRequest {
    pub access: CreateRequestAccess,

    pub document_id: String,

    pub durable: bool,

    pub hostname: Option<String>,

    pub permissions: SurfacePermissions,

    pub presence_color: PresenceColor,

    pub presence_refresh_ms: Option<i64>,

    pub presence_timeout_ms: i64,

    pub presence_user_id: Option<String>,

    pub preset: Preset,

    pub scope: SurfaceScope,

    pub session_id: String,

    pub snapshot_base64: String,

    pub snapshot_interval_ms: i64,

    pub traceparent: Option<String>,

    pub transport: Transport,

    pub user: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CreateRequestAccess {
    Comment,

    Edit,

    Read,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfacePermissions {
    pub can_comment: bool,

    pub can_write: bool,

    pub content_interactable: bool,

    pub current: bool,

    pub editor_editable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PresenceColor {
    Blue,

    Cyan,

    Green,

    Lime,

    Orange,

    Pink,

    Purple,

    Red,

    Teal,

    Violet,

    Yellow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Preset {
    Calendar,

    Chat,

    Markdown,

    #[serde(rename = "markdownSync")]
    MarkdownSync,

    #[serde(rename = "plainText")]
    PlainText,

    Title,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Transport {
    Direct,

    #[serde(rename = "none")]
    TransportNone,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FocusRequest {
    pub focused: bool,

    pub mount_generation: i64,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LayoutRequest {
    pub clip_bottom: f64,

    pub clip_left: f64,

    pub clip_right: f64,

    pub clip_top: f64,

    pub height: f64,

    pub left: f64,

    pub mount_generation: i64,

    pub scope: SurfaceScope,

    pub top: f64,

    pub viewport_width: f64,

    pub visible: bool,

    pub width: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LifecycleRequest {
    pub scope: SurfaceScope,

    pub signal: Signal,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Signal {
    Hidden,

    Online,

    #[serde(rename = "pageHide")]
    PageHide,

    Visible,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MountRequest {
    pub aria_label: String,

    pub dark_mode: bool,

    pub font_size_css_px: f64,

    pub hint_color_argb: i64,

    pub line_height_css_px: f64,

    pub mount_generation: i64,

    pub placeholder: String,

    pub scope: SurfaceScope,

    pub text_color_argb: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub permissions: SurfacePermissions,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryReply {
    pub json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryRequest {
    pub kind: QueryRequestKind,

    pub model_generation: i64,

    pub name: Option<String>,

    pub payload_json: Option<String>,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QueryRequestKind {
    Application,

    Clipboard,

    Markdown,

    #[serde(rename = "savedState")]
    SavedState,

    #[serde(rename = "selectedMarkdown")]
    SelectedMarkdown,

    State,

    Text,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceEvent {
    pub can_redo: Option<bool>,

    pub can_undo: Option<bool>,

    pub kind: SurfaceEventKind,

    pub message: Option<String>,

    pub model_generation: i64,

    pub name: Option<String>,

    pub payload_json: Option<String>,

    pub request_id: Option<i64>,

    pub revision: i64,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SurfaceEventKind {
    Changed,

    Error,

    History,

    Plugin,

    Ready,

    Status,

    Stopped,

    Telemetry,

    Token,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenResultRequest {
    pub access: TokenResultRequestAccess,

    pub request_id: i64,

    pub scope: SurfaceScope,

    pub socket_url: Option<String>,

    pub token: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TokenResultRequestAccess {
    #[serde(rename = "none")]
    AccessNone,

    #[serde(rename = "commentMarks")]
    CommentMarks,

    Full,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UnmountRequest {
    pub mount_generation: i64,

    pub scope: SurfaceScope,
}
