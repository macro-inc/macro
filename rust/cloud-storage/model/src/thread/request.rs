use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchThreadRequestV2 {
    /// The new project that the thread will belong to.
    pub project_id: Option<String>,
    /// The share permissions for the thread.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}
