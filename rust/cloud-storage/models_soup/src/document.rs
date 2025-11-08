use chrono::Utc;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SoupDocument {
    /// The document id
    pub id: String,

    /// The version of the document
    /// This could be the document_instance_id or document_bom_id depending on the file type
    pub document_version_id: i64,

    /// The owner of the document
    pub owner_id: String,

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
    pub project_id: Option<String>,

    /// The id of the document this document branched from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_id: Option<String>,

    /// The id of the version this document branched from
    /// This could be either DocumentInstance or DocumentBom id depending on the file type
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branched_from_version_id: Option<i64>,

    /// The id of the document family this document belongs to
    #[serde(skip_serializing_if = "Option::is_none")]
    pub document_family_id: Option<i64>,

    /// The time the document was created
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub created_at: chrono::DateTime<Utc>,

    /// The time the document instance / document BOM was updated
    #[serde(with = "chrono::serde::ts_milliseconds")]
    #[schema(value_type = i64)]
    pub updated_at: chrono::DateTime<Utc>,

    /// The time the document was last viewed
    #[serde(with = "chrono::serde::ts_milliseconds_option")]
    #[schema(value_type = i64, nullable = true)]
    pub viewed_at: Option<chrono::DateTime<Utc>>,
}

#[expect(
    clippy::too_many_arguments,
    reason = "no good reason but too hard to fix right now"
)]
pub fn map_soup_document(
    id: String,
    user_id: String,
    document_version_id: Option<String>,
    name: String,
    sha: Option<String>,
    file_type: Option<String>,
    document_family_id: Option<i64>,
    branched_from_id: Option<String>,
    branched_from_version_id: Option<i64>,
    project_id: Option<String>,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
    viewed_at: Option<chrono::DateTime<Utc>>,
) -> anyhow::Result<SoupDocument> {
    Ok(SoupDocument {
        id,
        owner_id: user_id,
        document_version_id: document_version_id
            .ok_or_else(|| anyhow::anyhow!("document_version_id is required"))?
            .parse::<i64>()?,
        name,
        sha,
        file_type,
        document_family_id,
        branched_from_id,
        branched_from_version_id,
        project_id,
        created_at,
        updated_at,
        viewed_at,
    })
}
