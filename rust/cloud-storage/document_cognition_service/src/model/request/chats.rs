use ai::types::Model;
pub use model::chat::NewAttachment;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateChatRequest {
    pub name: Option<String>,
    pub model: Option<Model>,
    pub project_id: Option<String>,
    pub attachments: Option<Vec<NewAttachment>>,
    pub is_persistent: Option<bool>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CopyChatRequest {
    pub name: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
pub struct GetChatPathParams {
    pub chat_id: String,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchChatRequest {
    pub name: Option<String>,
    pub model: Option<String>,
    pub project_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchChatRequestV2 {
    pub name: Option<String>,
    pub model: Option<String>,
    pub project_id: Option<String>,
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}
