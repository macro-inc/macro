use model::chat::ChatMessageWithAttachments;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// What kind of agent backs a chat.
#[non_exhaustive]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
pub enum ChatAgentKind {
    /// A native Macro agent chat.
    #[default]
    MacroChat,
    /// A chat backed by an external ACP agent runtime.
    External,
}

impl ChatAgentKind {
    /// Storage representation (the `Chat."agentKind"` column value).
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::MacroChat => "MacroChat",
            Self::External => "External",
        }
    }
}

impl std::str::FromStr for ChatAgentKind {
    type Err = String;

    fn from_str(value: &str) -> std::result::Result<Self, Self::Err> {
        match value {
            "MacroChat" => Ok(Self::MacroChat),
            "External" => Ok(Self::External),
            other => Err(format!("unknown chat agent kind: {other}")),
        }
    }
}

/// Arguments for creating a new chat.
#[derive(Debug, Default)]
pub struct CreateChatArgs {
    /// The name of the chat.
    pub name: String,
    /// The project to associate the chat with.
    pub project_id: Option<String>,
    /// What kind of agent backs the chat.
    pub kind: ChatAgentKind,
}

/// Arguments for copying a chat.
#[derive(Debug)]
pub struct CopyChatArgs {
    /// The name for the new (copied) chat.
    pub name: String,
    /// The project to place the copy in (may differ from the source).
    pub project_id: Option<String>,
}

/// Arguments for patching a chat.
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
