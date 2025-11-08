use super::file_type::FileType;
use chrono::serde::ts_seconds_option;
use utoipa::ToSchema;

#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[serde(rename_all = "snake_case")]
pub struct Document {
    /// The document uuid
    pub id: String,
    /// The owner of the document
    pub owner: String,
    /// The name of the document
    pub name: String,
    /// The file type
    pub file_type: String,
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
    /// The id of the project this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    /// The time the document was created
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    /// The time the document was last updated
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Simple struct to retrvieve just an ID from db
#[derive(
    sqlx::FromRow, serde::Serialize, serde::Deserialize, Debug, Hash, PartialEq, Eq, Clone,
)]
#[serde(rename_all = "snake_case")]
pub struct ID {
    pub id: String,
}

/// Simple struct to retrvieve an ID with created/updated timestamps from db
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct IDWithTimeStamps {
    pub id: String,
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Simple struct to retrvieve just an ID from db
#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct VersionID {
    pub id: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, sqlx::FromRow)]
#[serde(rename_all = "snake_case")]
pub struct VersionIDWithTimeStampsOptionalSha {
    pub id: i64,
    pub sha: Option<String>,
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Simple struct to retrvieve an ID with created/updated timestamps from db
#[derive(serde::Serialize, serde::Deserialize, Debug, sqlx::FromRow)]
#[serde(rename_all = "snake_case")]
pub struct VersionIDWithTimeStampsNoSha {
    pub id: i64,
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Simple struct to retrvieve an ID with created/updated timestamps from db
#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "snake_case")]
pub struct VersionIDWithTimeStamps {
    pub id: i64,
    pub sha: String,
    #[serde(with = "ts_seconds_option")]
    pub created_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(with = "ts_seconds_option")]
    pub updated_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Returns basic information of a document used for some db queries
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone, ToSchema, Default)]
#[serde(default, rename_all = "camelCase")]
pub struct DocumentBasic {
    pub document_id: String,
    pub document_name: String,
    pub owner: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    #[serde(with = "ts_seconds_option", skip_serializing_if = "Option::is_none")]
    #[schema(value_type = i64, nullable=true)]
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Returns basic information of a document used for document context
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[serde(rename_all = "snake_case")]
pub struct DocumentInfo {
    pub document_id: String,
    pub document_owner: String,
    pub file_type: String,
}

impl DocumentBasic {
    pub fn is_text_content(&self) -> bool {
        self.file_type
            .clone()
            .and_then(|f| FileType::from_str(f.as_str()))
            .map(|ft| ft.is_text_content())
            .unwrap_or(false)
    }
    pub fn try_file_type(&self) -> Option<FileType> {
        self.file_type.as_deref().and_then(FileType::from_str)
    }
}
