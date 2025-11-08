pub mod folder;

use serde::{Deserialize, Serialize};
use strum::{Display, EnumString};
use utoipa::ToSchema;

pub use folder::*;

/// The upload status of the folder
#[derive(
    Debug, Serialize, Deserialize, Clone, EnumString, Display, Default, Eq, PartialEq, ToSchema,
)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UploadFolderStatus {
    Pending,
    Uploaded,
    Processing,
    PartiallyCompleted,
    Completed,
    Failed,
    #[default]
    Unknown,
}

/// The upload status of the document
#[derive(Debug, Serialize, Deserialize, EnumString, Display, Default, ToSchema)]
#[strum(serialize_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum UploadDocumentStatus {
    Pending,
    Completed,
    Failed,
    #[default]
    Unknown,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum UploadFolderStatusUpdate {
    #[serde(rename_all = "camelCase")]
    Completed {
        request_id: String,
        project_id: String,
    },
    #[serde(rename_all = "camelCase")]
    PartiallyCompleted {
        request_id: String,
        project_id: String,
    },
    #[serde(rename_all = "camelCase")]
    Failed { request_id: String },
    #[serde(rename_all = "camelCase")]
    Unknown { request_id: String },
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BulkUploadRequest {
    pub request_id: String,
    pub user_id: String,
    pub key: String,
    pub status: UploadFolderStatus,
    pub name: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub completed_at: Option<String>,
    pub error_message: Option<String>,
    pub root_project_id: Option<String>,
    pub parent_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDocumentStatus {
    pub document_id: String,
    pub status: UploadDocumentStatus,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BulkUploadRequestDocuments {
    pub root_project_id: String,
    pub documents: Vec<ProjectDocumentStatus>,
}
