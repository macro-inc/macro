use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum OrganizationUserRole {
    Owner,
    Member,
}

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct PatchUserRoleRequest {
    /// The user id who we are updating the role for
    pub user_id: String,
    /// The new role to give the user
    pub organization_user_role: OrganizationUserRole,
}
