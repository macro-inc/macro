use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetUserInfo {
    /// The user id
    pub user_id: String,
    /// The user's organization id if there is one associated with the user
    #[serde(skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<i32>,
    /// The user's permissions
    pub permissions: Vec<String>,
}
