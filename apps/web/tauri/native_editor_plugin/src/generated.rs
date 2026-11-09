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
use std::collections::HashMap;

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

    pub menu_commit_request: MenuCommitRequest,

    pub menu_rows_request: MenuRowsRequest,

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
pub struct MenuCommitRequest {
    pub choice: MenuChoice,

    pub identity: MenuIdentity,

    pub row_id: String,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuChoice {
    pub agent_session: Option<MenuAgentSession>,

    pub block: Option<Block>,

    pub booking_link: Option<MenuBookingLink>,

    pub date: Option<MenuDate>,

    pub document: Option<MenuDocument>,

    pub group_alias: Option<String>,

    pub kind: ChoiceKind,

    pub snippet_nodes_json: Option<String>,

    pub text: Option<String>,

    pub user: Option<MenuUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuAgentSession {
    pub id: String,

    pub label: Option<String>,

    pub mention_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Block {
    Bullet,

    Check,

    Code,

    Heading1,

    Heading2,

    Heading3,

    Link,

    Number,

    Paragraph,

    Quote,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBookingLink {
    pub label: Option<String>,

    pub profile_id: Option<String>,

    pub slug: Option<String>,

    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuDate {
    pub date: String,

    pub display_format: String,

    pub mention_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuDocument {
    pub block_name: String,

    pub block_params: Option<HashMap<String, String>>,

    pub channel_type: Option<String>,

    pub collapsed: Option<bool>,

    pub created_at: Option<i64>,

    pub document_id: String,

    pub document_name: String,

    pub mention_uuid: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ChoiceKind {
    #[serde(rename = "agent-session")]
    AgentSession,

    Block,

    #[serde(rename = "booking-link")]
    BookingLink,

    Date,

    Document,

    Group,

    Snippet,

    Text,

    User,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuUser {
    pub display_name: String,

    pub email: Option<String>,

    pub mention_uuid: Option<String>,

    pub user_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuIdentity {
    pub invocation: i64,

    pub model_generation: i64,

    pub mount_generation: i64,

    pub query_generation: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuRowsRequest {
    pub buckets: Vec<MenuBucket>,

    pub identity: MenuIdentity,

    pub rejected_row_id: Option<String>,

    pub rows: Vec<MenuRow>,

    pub scope: SurfaceScope,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuBucket {
    pub error: Option<String>,

    pub has_more: bool,

    pub id: String,

    pub is_loading: bool,

    pub is_loading_more: bool,

    pub label: String,

    pub loaded_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuRow {
    pub bucket_id: String,

    pub detail: Option<String>,

    pub disabled: Option<bool>,

    pub id: String,

    pub label: String,
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

    pub menu: Option<MenuEvent>,

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

    Menu,

    Plugin,

    Ready,

    Status,

    Stopped,

    Telemetry,

    Token,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuEvent {
    pub action: Action,

    pub bucket_id: Option<String>,

    pub query: MenuQuery,

    pub row_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Action {
    Closed,

    More,

    Query,

    Select,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuQuery {
    pub identity: MenuIdentity,

    pub kind: QueryKind,

    pub node_types: Vec<String>,

    pub selected_index: i64,

    pub term: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum QueryKind {
    Action,

    Emoji,

    Mention,

    Snippet,
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
