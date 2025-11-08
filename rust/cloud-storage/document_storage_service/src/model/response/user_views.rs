use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Eq, PartialEq, Debug, ToSchema)]
pub struct UserViewsResponse {
    /// List of user emails who have viewed the document
    pub users: Vec<String>,
    /// Total number of views for the document
    pub count: i64,
}
