use models_permissions::share_permission::access_level::AccessLevel;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetThreadUserAccessLevelResponse {
    /// The user's access level to the document
    pub user_access_level: AccessLevel,
}
