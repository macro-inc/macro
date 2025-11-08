use chrono::serde::ts_seconds_option;
use utoipa::ToSchema;

use models_permissions::share_permission::SharePermissionV2;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatPreview {
    Access(ChatPreviewData),
    NoAccess(WithChatId),
    DoesNotExist(WithChatId),
}

pub enum ChatPreviewV2 {
    Found(ChatPreviewData),
    DoesNotExist(WithChatId),
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct ChatPreviewDataWithSharePermission {
    /// The chat id
    pub chat_id: String,
    /// The name of the chat
    pub chat_name: String,
    /// The share permission for the chat
    pub share_permission: SharePermissionV2,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema, Clone)]
pub struct ChatPreviewData {
    pub chat_id: String,
    pub chat_name: String,
    pub owner: String,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct WithChatId {
    pub chat_id: String,
}
