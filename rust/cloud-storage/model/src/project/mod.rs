use chrono::serde::ts_seconds_option;
use models_bulk_upload::ProjectDocumentStatus;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

pub mod request;
pub mod response;

#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, Eq, PartialEq, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    /// The id of the project
    pub id: String,
    /// The name of the project
    pub name: String,
    /// The user id of who created the project
    pub user_id: String,
    /// The parent project id
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_id: Option<String>,
    /// The time the project was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the project was updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,

    /// The time the project was deleted
    #[serde(skip_serializing_if = "Option::is_none", with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

pub struct ProjectWithUploadRequest {
    pub project: Project,
    pub upload_request_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PendingProject {
    #[serde(flatten)]
    pub project: Project,
    pub document_statuses: Vec<ProjectDocumentStatus>,
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, Eq, PartialEq, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct BasicProject {
    pub id: String,
    pub user_id: String,
    pub parent_id: Option<String>,
    pub name: String,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "access", rename_all = "snake_case")]
pub enum ProjectPreview {
    Access(ProjectPreviewData),
    NoAccess(WithProjectId),
    DoesNotExist(WithProjectId),
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, Eq, PartialEq, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPreviewData {
    pub id: String,
    pub name: String,
    pub owner: String,
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(Serialize, Deserialize, Eq, PartialEq, Debug, Clone, ToSchema)]
#[serde(tag = "access", rename_all = "snake_case")]
pub enum ProjectPreviewV2 {
    Found(ProjectPreviewData),
    DoesNotExist(WithProjectId),
}

#[derive(Serialize, Deserialize, Debug, ToSchema, Clone, Eq, PartialEq, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct WithProjectId {
    pub id: String,
}
