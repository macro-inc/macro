use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UserDocumentViewLocationResponse {
    pub location: Option<String>,
}
