use crate::model::chats::ChatResponse;
use ai::types::Model;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use models_permissions::share_permission::access_level::AccessLevel;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetChatPermissionsResponseV2 {
    pub permissions: models_permissions::share_permission::SharePermissionV2,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetChatResponse {
    pub chat: ChatResponse,
    pub user_access_level: AccessLevel,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetModelsResponse {
    pub models: Vec<Model>,
}
