#[derive(
    serde::Serialize,
    serde::Deserialize,
    Eq,
    PartialEq,
    Debug,
    utoipa::ToSchema,
    Clone,
    PartialOrd,
    sqlx::Type,
    strum::EnumString,
    strum::Display,
    Copy,
    std::cmp::Ord,
)]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "snake_case")]
#[sqlx(type_name = "\"team_role\"", rename_all = "lowercase")]
/// Ordered from least to most access top -> bottom
pub enum TeamRole {
    Member,
    Admin,
    Owner,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct Team {
    pub id: sqlx::types::Uuid,
    pub name: String,
    pub owner_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamWithUsers {
    pub team: Team,
    pub users: Vec<TeamUser>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamInvite {
    pub id: sqlx::types::Uuid,
    pub email: String,
    pub team_id: sqlx::types::Uuid,
    pub team_role: TeamRole,
    pub invited_by: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub last_sent_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamUser {
    pub user_id: String,
    pub team_id: sqlx::types::Uuid,
    pub team_role: TeamRole,
}

#[derive(
    serde::Serialize,
    serde::Deserialize,
    Clone,
    Debug,
    strum::Display,
    strum::EnumString,
    utoipa::ToSchema,
    PartialEq,
    Eq,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TeamUpdateOperation {
    Update,
    Remove,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamInviteUpdate {
    /// The team invite id to update
    pub team_invite_id: sqlx::types::Uuid,
    /// The role to assign to the invited user
    /// This is only used for `Update` operation
    pub team_role: Option<TeamRole>,
    /// The operation to perform
    /// `Update` will update the existing invitation role
    /// `Remove` will remove the invitation
    pub operation: TeamUpdateOperation,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct TeamUserUpdate {
    /// The user id to update or remove
    pub user_id: String,
    /// The new role for the user if the operation is `Update`
    pub team_role: Option<TeamRole>,
    /// The operation to perform
    /// `Update` will update the existing user role
    /// `Remove` will remove the user
    pub operation: TeamUpdateOperation,
}

/// The request body to update a team
#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct PatchTeamRequest {
    /// The new name of the team
    pub name: Option<String>,
}
