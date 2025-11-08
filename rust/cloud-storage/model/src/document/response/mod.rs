mod location;
pub use location::*;

use crate::{document::DocumentMetadata, response::PresignedUrl};
use chrono::serde::ts_seconds_option;
use models_permissions::share_permission::access_level::AccessLevel;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentListResult {
    /// The id of the document
    pub document_id: String,
    /// The id of the document version
    pub document_version_id: i64,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// The id of the document this document branched from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<String>,
    /// The id of the version this document branched from
    /// This could be either DocumentInstance or DocumentBom id depending on
    /// the file type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,
    /// The id of the document family this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,
    /// The time the document was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the document instance / document BOM was updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetDocumentResponse {
    /// Indicates if an error occurred
    pub error: bool,
    /// Data to be returned
    pub data: GetDocumentResponseData,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetDocumentResponseData {
    /// The metadata of the document
    pub document_metadata: DocumentMetadata,
    /// The users level of access to the document
    pub user_access_level: AccessLevel,
    /// The users view location if there is one
    pub view_location: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum LocationResponseData {
    /// The presigned url of the document if it is not a docx
    PresignedUrl(String),
    /// The presigned urls of the docx bom parts if it is a docx
    PresignedUrls(Vec<PresignedUrl>),
}
