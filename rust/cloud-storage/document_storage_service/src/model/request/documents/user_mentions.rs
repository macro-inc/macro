use serde::Deserialize;
use utoipa::ToSchema;

// TODO: add support for mention location
#[derive(Debug, Deserialize, ToSchema)]
pub struct UpsertUserMentionsRequest {
    /// List of user ids that are mentioned for this notification
    pub mentions: Vec<String>,
    /// Custom metadata that may be needed for the notification
    pub metadata: Option<serde_json::Value>,
}
