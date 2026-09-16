use model::chat::ChatMessageWithAttachments;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::AuthorizedTeamShareCommand;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// Arguments for creating a new chat.
#[derive(Debug)]
pub struct CreateChatArgs {
    /// The name of the chat.
    pub name: String,
    /// The project to associate the chat with.
    pub project_id: Option<String>,
}

/// Arguments for copying a chat.
#[derive(Debug)]
pub struct CopyChatArgs {
    /// The name for the new (copied) chat.
    pub name: String,
    /// The project to place the copy in (may differ from the source).
    pub project_id: Option<String>,
}

/// Arguments for patching a chat, as supplied by inbound callers.
#[derive(Debug)]
pub struct PatchChatArgs {
    /// New name for the chat, if changing.
    pub name: Option<String>,
    /// New project ID for the chat, if moving. Empty string clears the project.
    pub project_id: Option<String>,
    /// Share permission updates, if changing.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

/// Arguments the domain service hands to the repository when patching a chat.
///
/// Only the service can produce the authorized team-share command, so inbound
/// callers cannot request a team grant the owner policy has not approved.
#[derive(Debug)]
pub struct PatchChatRepoArgs {
    /// New name for the chat, if changing.
    pub name: Option<String>,
    /// New project ID for the chat, if moving. Empty string clears the project.
    pub project_id: Option<String>,
    /// Share permission updates, if changing.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
    /// Owner-authorized team-share write, present only when the request
    /// carried an explicit `teamShareAccessLevel`.
    pub team_share: Option<AuthorizedTeamShareCommand>,
}

/// Wrapper response for get_chat, matching the DCS API response shape.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetChatResponse {
    /// The full chat data.
    pub chat: ChatResponse,
    /// The requesting user's access level on this chat.
    pub user_access_level: AccessLevel,
}

/// The full chat response, matching the DCS API response shape.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChatResponse {
    /// The chat uuid.
    pub id: String,
    /// Who the chat belongs to.
    pub user_id: String,
    /// The project id the chat belongs to.
    pub project_id: Option<String>,
    /// The name of the chat.
    pub name: String,
    /// The messages in the chat.
    pub messages: Vec<ChatMessageWithAttachments>,
    /// The model used to generate the chat (`provider/model` id).
    pub model: Option<String>,
    /// The time the chat was created.
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the chat was last updated.
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}
