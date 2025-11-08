use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectRequest {
    /// The name of the project.
    pub name: String,
    /// The project that the new project will belong to.
    pub project_parent_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PatchProjectRequestV2 {
    /// The new name of the project.
    pub name: Option<String>,
    /// The new project that the new project will belong to.
    pub project_parent_id: Option<String>,
    /// The share permissions for the project.
    pub share_permission:
        Option<models_permissions::share_permission::UpdateSharePermissionRequestV2>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetBatchProjectPreviewRequest {
    pub project_ids: Vec<String>,
}
