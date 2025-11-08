use model::macros::MacroResponse;
use models_permissions::share_permission::access_level::AccessLevel;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetMacroPermissionsResponseV2 {
    pub permissions: models_permissions::share_permission::SharePermissionV2,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetMacroResponse {
    pub macro_item: MacroResponse,
    pub user_access_level: AccessLevel,
}
