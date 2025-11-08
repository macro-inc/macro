use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct DeleteUserRequest {
    /// The user id who we are deleting
    pub user_id: String,
}
