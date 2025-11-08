use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetInvitedUsersResponse {
    /// The invited users in your organization
    pub invited_users: Vec<String>,
}
