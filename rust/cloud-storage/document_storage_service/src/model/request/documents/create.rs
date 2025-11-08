use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateDocumentRequest {
    /// The id of the document in the database
    pub id: Option<String>,
    /// The sha of the document.
    pub sha: String,
    /// The name of the document without extension.
    pub document_name: String,
    /// Optional file type of the document.
    pub file_type: Option<String>,
    /// The content type of the document (currently only used for logging matches against file type).
    pub mime_type: Option<String>,
    /// The document family id if the document is being branched.
    pub document_family_id: Option<i64>,
    /// The document id if the document is being branched.
    pub branched_from_id: Option<String>,
    /// The version id if the document is being branched.
    pub branched_from_version_id: Option<i64>,
    /// Optional job id to be used to track an upload job for the newly created document.
    /// Will need to have a corresponding job initiated for the file beforehand.
    pub job_id: Option<String>,
    //// Optional project id to be used to what project the document belongs to.
    pub project_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBlankDocxRequest {
    //// Optional project id to be used to what project the document belongs to.
    pub project_id: Option<String>,
}
