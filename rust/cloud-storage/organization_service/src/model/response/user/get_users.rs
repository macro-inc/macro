use model::organization::User;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetUsersResponse {
    /// The users in your organization returned from the query
    pub users: Vec<User>,
    /// The total number of documents the user has
    pub total: i64,
    /// The next offset to be used if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetUsersInternalResponse {
    /// The users in your organization returned from the query
    pub users: Vec<String>,
    /// The total number of documents the user has
    pub total: i64,
    /// The next offset to be used if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<i64>,
}
