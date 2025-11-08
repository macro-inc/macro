#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
pub struct LocationQueryParams {
    /// The document version id to get the location for
    pub document_version_id: Option<i64>,
    /// If true, this will return the converted docx url
    pub get_converted_docx_url: Option<bool>,
}
