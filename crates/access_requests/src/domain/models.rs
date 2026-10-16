//! Public request contracts and workflow values.
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// An entity type with an existing Share surface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ShareEntityType {
    /// Files and document-backed tasks, snippets and skills.
    Document,
    /// AI conversations.
    Chat,
    /// Folders.
    Project,
    /// Task projects.
    Initiative,
    /// Native databases.
    Database,
    /// Calls and their recordings.
    Call,
    /// Email threads.
    EmailThread,
    /// Agent conversations.
    AgentSession,
}
impl From<ShareEntityType> for EntityType {
    fn from(value: ShareEntityType) -> Self {
        match value {
            ShareEntityType::Document => Self::Document,
            ShareEntityType::Chat => Self::Chat,
            ShareEntityType::Project => Self::Project,
            ShareEntityType::Initiative => Self::Initiative,
            ShareEntityType::Database => Self::Database,
            ShareEntityType::Call => Self::Call,
            ShareEntityType::EmailThread => Self::EmailThread,
            ShareEntityType::AgentSession => Self::AgentSession,
        }
    }
}
/// A validated shared-entity address.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ShareEntity {
    /// Canonical entity kind.
    pub entity_type: ShareEntityType,
    /// Entity identifier.
    pub entity_id: Uuid,
}
/// Durable outcome; reading a notification never changes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum RequestStatus {
    /// Awaiting a reviewer.
    Pending,
    /// Access was granted.
    Granted,
    /// A reviewer denied the request.
    Denied,
    /// The requester withdrew it.
    Cancelled,
}
/// Latest request for one person and one entity.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequest {
    /// Stable request identity across revisions.
    pub id: Uuid,
    /// Person requesting access.
    #[schema(value_type = String)]
    pub requester_id: MacroUserIdStr<'static>,
    /// Requested upgrade.
    pub requested_level: AccessLevel,
    /// Current outcome.
    pub status: RequestStatus,
    /// Optimistic concurrency token.
    pub revision: i32,
    /// Start of this request attempt.
    pub created_at: DateTime<Utc>,
    /// Most recent change.
    pub updated_at: DateTime<Utc>,
    /// When the request stopped being pending.
    pub resolved_at: Option<DateTime<Utc>>,
    /// Level selected by the reviewer.
    pub granted_level: Option<AccessLevel>,
    /// Earliest next submission or level change; cancellation preserves this deadline.
    /// Submissions wait one minute, denials wait 24 hours, and approval clears it.
    pub retry_after: Option<DateTime<Utc>>,
}
/// A direct user grant; inherited grants are deliberately not editable here.
#[derive(Debug, Clone, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DirectAccess {
    /// Recipient.
    pub user_id: String,
    /// Direct permission level.
    pub access_level: AccessLevel,
}
/// Share state visible to one authenticated viewer.
#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccessRequestState {
    /// Recorded owner principal, visible to reviewers and callers with access.
    pub owner: Option<String>,
    /// Whether this viewer can resolve requests and manage direct grants.
    pub can_review: bool,
    /// Current effective permission, absent when requesting initial access.
    pub access_level: Option<AccessLevel>,
    /// Permitted access choices for this surface.
    pub supported_levels: Vec<AccessLevel>,
    /// This viewer's last request, if any.
    pub mine: Option<AccessRequest>,
    /// Reviewer-only pending page, oldest first.
    pub requests: Vec<AccessRequest>,
    /// Total outstanding requests, for the Share badge.
    pub pending_count: i64,
    /// Next page offset, absent at the end.
    pub next_offset: Option<u32>,
}
/// Requester submission; an existing pending request requires its revision.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RequestAccess {
    /// Desired View, Comment, or Edit permission.
    pub requested_level: AccessLevel,
    /// Last observed revision; omitted only for the first request.
    pub revision: Option<i32>,
}
/// Owner's decision; omission of a granted level means deny.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ResolveRequest {
    /// Request revision being reviewed.
    pub revision: i32,
    /// Supported access to grant, or null to deny.
    pub granted_level: Option<AccessLevel>,
}
/// Direct-grant change. A null level removes only that direct grant.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetDirectAccess {
    /// New level, or removal.
    pub access_level: Option<AccessLevel>,
}
/// Delivery work committed with a request/grant change.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestEvent {
    /// Stable notification/delivery identity.
    pub id: Uuid,
    /// Shared item.
    pub entity: ShareEntity,
    /// Display name captured at the change.
    pub entity_name: String,
    /// File type used for document navigation.
    pub file_type: Option<String>,
    /// Request state; absent for a manual direct-grant change.
    pub request: Option<AccessRequest>,
    /// Actor who caused this event.
    pub actor: MacroUserIdStr<'static>,
    /// Responsible human reviewers at the time of the change.
    pub reviewers: Vec<MacroUserIdStr<'static>>,
    /// Everyone whose sharing/access caches changed.
    pub affected_users: Vec<MacroUserIdStr<'static>>,
    /// W3C trace context captured by the persistence adapter for durable delivery.
    #[serde(default, skip_serializing_if = "std::collections::HashMap::is_empty")]
    pub trace_context: std::collections::HashMap<String, String>,
    /// Previous requested notifications and their recipients to complete.
    pub superseded: Vec<(Uuid, Vec<MacroUserIdStr<'static>>)>,
}
/// Domain failures translated to HTTP only at the inbound boundary.
#[derive(Debug, thiserror::Error)]
pub enum RequestError {
    /// Caller cannot perform this operation.
    #[error("You do not have permission to perform this action")]
    Forbidden,
    /// Entity/request no longer exists.
    #[error("Item or request was not found")]
    NotFound,
    /// The submitted level is unavailable or not an upgrade.
    #[error("Choose an available access level above your current access")]
    InvalidLevel,
    /// Another actor changed the request first.
    #[error("This request changed. Refresh and try again")]
    Conflict,
    /// Denied requests cannot be repeated immediately.
    #[error("You can request access again after {0}")]
    Cooldown(DateTime<Utc>),
    /// Persistence or another dependency failed.
    #[error("Could not update access")]
    Internal(rootcause::Report),
}
