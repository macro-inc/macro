use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct ExtractTextFromAllDocumentsQueryParams {
    /// Force even documents with existing text to be extracted
    pub force: Option<bool>,
}
