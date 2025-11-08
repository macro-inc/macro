use utoipa::ToSchema;

use crate::item::ItemWithUserAccessLevel;
use crate::project::ProjectPreview;
use models_permissions::share_permission::access_level::AccessLevel;

use super::Project;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectsResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Vec<Project>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectContentResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// DSS Items inside of a given project with their user access level attached to each item
    pub data: Vec<ItemWithUserAccessLevel>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: Project,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetBatchProjectPreviewResponse {
    pub previews: Vec<ProjectPreview>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectResponseData {
    /// The metadata of the project
    pub project_metadata: Project,
    /// The users level of access to the project
    pub user_access_level: AccessLevel,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetProjectResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// The project metadata and user access level
    pub data: GetProjectResponseData,
}
