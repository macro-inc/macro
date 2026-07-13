use std::borrow::Cow;

#[derive(sqlx::FromRow, serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BomPart {
    pub sha: String,
    pub path: String,
    pub id: String,
    pub document_bom_id: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobSuccessDataInner {
    /// Whether the conversion was successful
    pub converted: bool,
    /// HACK: this is needed for legacy compare to know that the conversion/unzip has finished.
    pub bom_parts: Vec<BomPart>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobData {
    pub error: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<DocxUploadJobSuccessDataInner>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DocxUploadJobResult<'a> {
    pub job_id: Cow<'a, str>,
    pub status: Cow<'a, str>,
    pub job_type: Cow<'a, str>,
    pub data: DocxUploadJobData,
}
