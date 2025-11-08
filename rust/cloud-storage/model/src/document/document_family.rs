use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFamily {
    /// The document family id
    pub id: i64,
    /// The root documents uuid
    pub root_document_id: String,
}
