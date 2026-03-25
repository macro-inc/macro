//! Contains the models for teams

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use roles_and_permissions::domain::model::UserRolesAndPermissionsError;

#[derive(
    Eq, PartialEq, Debug, Clone, PartialOrd, sqlx::Type, Copy, std::cmp::Ord, serde::Serialize,
)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[sqlx(type_name = "\"team_role\"", rename_all = "lowercase")]
/// Ordered from least to most access top -> bottom
pub enum TeamRole {
    /// The user is a member of the team
    Member,
    /// The user is an admin of the team
    Admin,
    /// The user is the owner of the team
    Owner,
}

impl std::fmt::Display for TeamRole {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            TeamRole::Member => write!(f, "member"),
            TeamRole::Admin => write!(f, "admin"),
            TeamRole::Owner => write!(f, "owner"),
        }
    }
}

/// The team member struct
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamMember<'a> {
    /// The id of the team
    pub team_id: uuid::Uuid,
    /// The user id of the team member
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'a>,
    /// The role of the team member
    pub role: TeamRole,
}

/// A team with its members
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamWithMembers {
    /// The team
    pub team: Team,
    /// The members of the team
    pub members: Vec<TeamMember<'static>>,
}

/// Detailed information about a team invite
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamInviteDetails {
    /// The invite id
    pub id: uuid::Uuid,
    /// The invited email
    pub email: String,
    /// The team id
    pub team_id: uuid::Uuid,
    /// The role being invited as
    pub team_role: TeamRole,
    /// The user who sent the invitation
    pub invited_by: String,
    /// When the invite was created
    pub created_at: DateTime<Utc>,
    /// When the invite was last sent
    pub last_sent_at: DateTime<Utc>,
}

/// Request to update a team
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchTeamRequest {
    /// The new name for the team
    pub name: Option<String>,
}

/// The Team struct
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct Team {
    pub(crate) id: uuid::Uuid,
    pub(crate) name: String,
    pub(crate) owner_id: String,
}

impl Team {
    /// Creates a new Team
    pub fn new(id: uuid::Uuid, name: String, owner_id: String) -> Self {
        Self { id, name, owner_id }
    }
}

impl Team {
    /// The id of the team
    pub fn id(&self) -> &uuid::Uuid {
        &self.id
    }

    /// The name of the team
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The owner id of the team
    pub fn owner_id(&self) -> &str {
        &self.owner_id
    }
}

/// Request to create a new team
pub struct CreateTeamRequest {
    name: String,
}

impl CreateTeamRequest {
    /// Creates a new CreateTeamRequest
    pub fn new(name: String) -> Self {
        Self { name }
    }

    /// The name of the team
    pub fn name(&self) -> &str {
        &self.name
    }
}

/// The team invite struct
#[derive(Debug, Clone)]
pub struct TeamInvite<'a> {
    /// The team id
    pub team_id: uuid::Uuid,
    /// The team invite id
    pub team_invite_id: uuid::Uuid,
    /// The email of the user
    pub email: Email<Lowercase<'a>>,
}

impl TeamInvite<'static> {
    /// Converts the team invite to a statically allocated team invite
    pub fn into_owned(&self) -> TeamInvite<'static> {
        TeamInvite {
            team_id: self.team_id,
            team_invite_id: self.team_invite_id,
            email: self.email.to_owned(),
        }
    }
}

/// Errors for team
#[derive(Debug, thiserror::Error)]
pub enum TeamError {
    /// The team does not exist
    #[error("The team does not exist")]
    TeamDoesNotExist,
    /// The subscription does not exist
    #[error("No subscription")]
    NoSubscription,
    /// The team subscription id is invalid
    #[error("Invalid subscription id")]
    InvalidSubscriptionId,
    /// The team invite does not exist
    #[error("The team invite does not exist")]
    TeamInviteDoesNotExist,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for creating team
#[derive(Debug, thiserror::Error)]
pub enum CreateTeamError {
    /// The team name is invalid
    #[error("The team name is invalid: {0}")]
    InvalidTeamName(String),
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for inviting users to team
#[derive(Debug, thiserror::Error)]
pub enum InviteUsersToTeamError {
    /// Too many emails were provided
    #[error("Too many emails were provided")]
    TooManyEmails,
    /// Underlying team error
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("Underlying customer error {0}")]
    CustomerError(#[from] CustomerError),
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for removing a user from a team
#[derive(Debug, thiserror::Error)]
pub enum RemoveUserFromTeamError {
    /// The team does not exist
    #[error("The team does not exist")]
    TeamDoesNotExist,
    /// The user is not in the team
    #[error("The user is not in the team")]
    UserNotInTeam,
    /// Team error
    #[error("Team error")]
    TeamError(#[from] TeamError),
    /// There is no subscription for the team
    #[error("There is no subscription for the team")]
    NoSubscription,
    /// Underlying customer error
    #[error("Underlying customer error")]
    CustomerError(#[from] CustomerError),
    /// The user is the owner of the team
    #[error("Cannot remove owner")]
    CannotRemoveOwner,
    /// Storage layer error
    #[error("Storage layer error")]
    StorageLayerError(#[from] anyhow::Error),
    /// Remove roles from user error
    #[error("Remove roles from user error")]
    RemoveRolesFromUserError(#[from] UserRolesAndPermissionsError),
}

/// Arguments for creating a subscription
#[derive(Debug, Clone)]
pub struct CreateSubscriptionArgs {
    /// The customer id
    pub customer_id: stripe::CustomerId,
    /// The quantity
    pub quantity: u64,
    /// The metadata to attach to the subscription
    pub metadata: Option<HashMap<String, String>>,
}

/// Errors for customer repository
#[derive(Debug, thiserror::Error)]
pub enum CustomerError {
    #[error("No stripe customer id")]
    /// The customer does not have a stripe customer id
    NoStripeCustomerId,
    /// The subscription is not active
    #[error("Subscription is not active")]
    SubscriptionNotActive,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for removing a team invite
#[derive(Debug, thiserror::Error)]
pub enum RemoveTeamInviteError {
    /// The user is not invited to the team
    #[error("The user is not invited to the team")]
    UserNotInTeam,
    /// The team invite does not exist
    #[error("The team invite does not exist")]
    TeamInviteDoesNotExist,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
    /// Underlying team error
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("Underlying customer error {0}")]
    CustomerError(#[from] CustomerError),
}

/// Errors for deleting a team
#[derive(Debug, thiserror::Error)]
pub enum DeleteTeamError {
    /// Storage layer error
    #[error("Storage layer error")]
    StorageLayerError(#[from] anyhow::Error),
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("Underlying customer error")]
    CustomerError(#[from] CustomerError),
    /// Remove roles from user error
    #[error("Remove roles from user error")]
    RemoveRolesFromUserError(#[from] UserRolesAndPermissionsError),
}

/// Errors for joining a team
#[derive(Debug, thiserror::Error)]
pub enum JoinTeamError {
    /// Storage layer error
    #[error("Storage layer error")]
    StorageLayerError(#[from] anyhow::Error),
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("Underlying customer error")]
    CustomerError(#[from] CustomerError),
    /// The user was not invited to the team
    #[error("User not invited")]
    UserNotInvited,
    #[error("Underlying user roles and permissions error")]
    /// Underlying user roles and permissions error
    AddRolesToUserError(#[from] UserRolesAndPermissionsError),
}

/// Errors for reinviting a user to a team
#[derive(Debug, thiserror::Error)]
pub enum ReinviteError {
    /// The invite was sent too recently
    #[error("Too many requests")]
    TooManyRequests,
    /// The invite does not exist
    #[error("Invite not found")]
    InviteNotFound,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for revoking permissions for team members
#[derive(Debug, thiserror::Error)]
pub enum RevokePermissionsForTeamMembersError {
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// Underlying user roles and permissions error
    #[error("Underlying user roles and permissions error")]
    RemoveRolesFromUserError(#[from] UserRolesAndPermissionsError),
}
