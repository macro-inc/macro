//! The basic document, chat and project rows that authorization extractors and
//! db queries load, split out of `model` so `entity_access` need not depend on it.

use std::str::FromStr;

use document_sub_type::DocumentSubType;
use model_file_type::FileType;
use model_owner::Owner;

/// Returns basic information of a document used for some db queries
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct DocumentBasic {
    pub document_id: String,
    pub document_name: String,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner: Owner,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<DocumentSubType>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<String>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl DocumentBasic {
    /// The stored file type, if it parses.
    pub fn try_file_type(&self) -> Option<FileType> {
        self.file_type
            .as_deref()
            .map(FileType::from_str)
            .and_then(Result::ok)
    }
}

/// Returns basic information of a chat used for some db queries
#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, Clone)]
pub struct ChatBasic {
    pub id: String,
    pub name: String,
    /// Who the chat belongs to
    pub user_id: Owner,
    pub project_id: Option<String>,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone, Eq, PartialEq)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "sqlx", derive(sqlx::FromRow))]
#[serde(rename_all = "camelCase")]
pub struct BasicProject {
    pub id: String,
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    #[cfg_attr(feature = "sqlx", sqlx(try_from = "String"))]
    pub user_id: Owner,
    pub parent_id: Option<String>,
    pub name: String,
    pub deleted_at: Option<chrono::DateTime<chrono::Utc>>,
}
