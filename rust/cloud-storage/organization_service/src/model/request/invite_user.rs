use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct InviteUserRequest {
    /// The email of the user to invite
    pub email: String,
}
