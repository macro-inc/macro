use chrono::serde::ts_seconds_option;
pub mod list;
pub mod response;
use utoipa::ToSchema;

mod file_type;
pub use file_type::*;
mod docx;
pub use docx::*;
mod pdf;
pub use pdf::*;
mod basic;
pub use basic::*;
mod document_family;
pub use document_family::*;
pub mod document_key;
pub use document_key::*;

use models_permissions::share_permission::access_level::AccessLevel;

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct DocumentPermissionsToken {
    /// The users id if present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    /// The document id
    pub document_id: String,
    /// The access level of the user for the document
    pub access_level: AccessLevel,
    /// The expiration time of the token
    pub exp: usize,
    /// The issuer of the token
    pub iss: String,
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
#[serde(rename_all = "camelCase")]
pub struct BasicDocument {
    /// The document id
    #[serde(rename = "id", alias = "documentId")]
    pub document_id: String,
    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on
    /// the file type
    pub document_version_id: i64,
    /// The owner of the document
    pub owner: String,
    /// The name of the document
    #[serde(rename = "name", alias = "documentName")]
    pub document_name: String,
    /// The file type of the document (e.g. pdf, docx)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// If the document is a PDF, this is the SHA of the pdf
    /// If the document is a DOCX, this will not be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    /// The id of the project that this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
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

    /// The time the document was deleted
    #[serde(skip_serializing_if = "Option::is_none", with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=true)]
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct BackfillDocumentInformation {
    /// The document id
    pub document_id: String,
    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on
    /// the file type
    pub document_version_id: i64,
    /// The owner of the document
    pub owner: String,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document (file extension)
    pub file_type: String,
    /// If the document is a DOCX document and unzipped, the document_bom will be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_bom: Option<serde_json::Value>,
}

#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct BackfillSearchDocumentInformation {
    pub document_id: String,
    pub document_version_id: i64,
    pub owner: String,
    pub file_type: FileType,
}

#[derive(
    sqlx::FromRow,
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    Clone,
    ToSchema,
    Default,
)]
#[serde(rename_all = "camelCase")]
pub struct DocumentMetadata {
    /// The document id
    pub document_id: String,
    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on
    /// the file type
    pub document_version_id: i64,
    /// The owner of the document
    pub owner: String,
    /// The name of the document
    pub document_name: String,
    /// The file type of the document (file extension)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// If the document is a PDF, this is the SHA of the pdf
    /// If the document is a DOCX, this will not be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,
    /// The id of the project that this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The name of the project that this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_name: Option<String>,
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
    /// If the document is a DOCX document and unzipped, the document_bom will be present
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Vec<BomPart>, nullable=true)]
    pub document_bom: Option<serde_json::Value>,
    /// The modification data for the document instance.
    /// This is only used for PDF documents.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modification_data: Option<serde_json::Value>,
    /// The time the document was created
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the document instance / document BOM was updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl DocumentMetadata {
    #[expect(
        clippy::too_many_arguments,
        reason = "no good reason but too hard to fix right now"
    )]
    pub fn new_docx(
        document_id: &str,
        document_bom_id: i64,
        owner: &str,
        document_name: &str,
        file_type: &str,
        document_family_id: Option<i64>,
        branched_from_id: Option<String>,
        branched_from_version_id: Option<i64>,
        project_id: Option<String>,
        project_name: Option<String>,
        created_at: Option<chrono::DateTime<chrono::Utc>>,
        updated_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Self {
        Self {
            document_id: document_id.to_string(),
            owner: owner.to_string(),
            document_name: document_name.to_string(),
            file_type: Some(file_type.to_string()),
            sha: None,
            document_version_id: document_bom_id,
            document_bom: Some(serde_json::json!([])),
            modification_data: None,
            document_family_id,
            branched_from_id,
            branched_from_version_id,
            project_id,
            project_name,
            created_at,
            updated_at,
        }
    }

    /// Creates a new document metadata
    #[expect(
        clippy::too_many_arguments,
        reason = "no good reason but too hard to fix right now"
    )]
    pub fn new_document(
        document_id: &str,
        document_instance_id: i64,
        owner: &str,
        document_name: &str,
        file_type: Option<FileType>,
        sha: &str,
        document_family_id: Option<i64>,
        branched_from_id: Option<&str>,
        branched_from_version_id: Option<i64>,
        project_id: Option<&str>,
        project_name: Option<&str>,
        created_at: Option<chrono::DateTime<chrono::Utc>>,
        updated_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Self {
        Self {
            document_id: document_id.to_string(),
            owner: owner.to_string(),
            document_name: document_name.to_string(),
            file_type: file_type.map(|s| s.as_str().to_string()),
            sha: Some(sha.to_string()),
            document_version_id: document_instance_id,
            document_bom: None,
            modification_data: None,
            document_family_id,
            branched_from_id: branched_from_id.map(|s| s.to_string()),
            branched_from_version_id,
            project_id: project_id.map(|s| s.to_string()),
            project_name: project_name.map(|s| s.to_string()),
            created_at,
            updated_at,
        }
    }

    #[expect(
        clippy::too_many_arguments,
        reason = "no good reason but too hard to fix right now"
    )]
    pub fn document(
        document_id: &str,
        document_instance_id: i64,
        owner: &str,
        document_name: &str,
        file_type: Option<&str>,
        sha: &str,
        modification_data: Option<serde_json::Value>,
        document_family_id: Option<i64>,
        branched_from_id: Option<String>,
        branched_from_version_id: Option<i64>,
        project_id: Option<String>,
        project_name: Option<String>,
        created_at: Option<chrono::DateTime<chrono::Utc>>,
        updated_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> Self {
        Self {
            document_id: document_id.to_string(),
            owner: owner.to_string(),
            document_name: document_name.to_string(),
            file_type: file_type.map(|s| s.to_string()),
            sha: Some(sha.to_string()),
            document_version_id: document_instance_id,
            document_bom: None,
            modification_data,
            document_family_id,
            branched_from_id,
            branched_from_version_id,
            project_id,
            project_name,
            created_at,
            updated_at,
        }
    }
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DocumentPreview {
    Access(DocumentPreviewData),
    NoAccess(WithDocumentId),
    DoesNotExist(WithDocumentId),
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
pub struct DocumentPreviewData {
    /// The document id
    pub document_id: String,
    /// The file type of the document (e.g. pdf, docx)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    /// The name of the document
    pub document_name: String,
    /// The id of the owner of the document
    pub owner: String,
    /// The time the document was last updated
    #[serde(with = "ts_seconds_option")]
    #[schema(value_type = i64, nullable=false)]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema,
)]
pub struct WithDocumentId {
    pub document_id: String,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum DocumentPreviewV2 {
    Found(DocumentPreviewData),
    DoesNotExist(WithDocumentId),
}
