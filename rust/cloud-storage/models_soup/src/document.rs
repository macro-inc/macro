use chrono::Utc;
use document_sub_type::DocumentSubType;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

/// Sub type of a document with associated properties encoded in each variant.
/// This ensures type-safety: task properties only exist when the document is a task.
#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SoupDocumentSubType {
    /// A task document with its associated properties
    Task {
        /// Whether the task is completed.
        /// True if the Status property is set to "Completed".
        is_completed: bool,
    },
}

impl SoupDocumentSubType {
    /// Converts from DB representation (separate sub_type and is_completed columns)
    /// to the domain enum.
    pub fn from_db(sub_type: Option<DocumentSubType>, is_completed: Option<bool>) -> Option<Self> {
        match sub_type? {
            DocumentSubType::Task => Some(Self::Task {
                is_completed: is_completed.unwrap_or_default(),
            }),
        }
    }

    /// Returns whether this is a completed task
    pub fn is_task_completed(&self) -> Option<bool> {
        match self {
            Self::Task { is_completed } => Some(*is_completed),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug, Clone)]
#[cfg_attr(feature = "mock", derive(PartialEq, Eq))]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupDocument {
    /// The document id
    pub id: Uuid,

    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on the file type
    pub document_version_id: i64,

    /// The owner of the document
    #[cfg_attr(feature = "schema", schema(value_type = String))]
    pub owner_id: MacroUserIdStr<'static>,

    /// The name of the document
    pub name: String,

    /// The file type of the document (e.g. pdf, docx)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_type: Option<String>,

    /// If the document is a PDF, this is the SHA of the pdf
    /// If the document is a DOCX, this will not be present
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha: Option<String>,

    /// The id of the project that this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,

    /// The id of the document this document branched from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<Uuid>,

    /// The id of the version this document branched from
    /// This could be either DocumentInstance or DocumentBom id depending on the file type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,

    /// The id of the document family this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,

    /// The time the document was created
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the document instance / document BOM was updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[cfg_attr(feature = "schema", schema(value_type = i64))]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the document was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[cfg_attr(feature = "schema", schema(value_type = i64, nullable = true))]
    pub viewed_at: Option<chrono::DateTime<Utc>>,

    /// The sub type of the document if present.
    /// Task-related properties are encoded within the variant.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sub_type: Option<SoupDocumentSubType>,
}
