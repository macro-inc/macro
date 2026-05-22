//! Contains the models for teams

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use roles_and_permissions::domain::model::UserRolesAndPermissionsError;

/// Team plans
#[derive(
    Eq,
    PartialEq,
    Debug,
    Clone,
    PartialOrd,
    Copy,
    std::cmp::Ord,
    serde::Serialize,
    serde::Deserialize,
)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "\"team_plan\"", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
pub enum TeamPlan {
    /// Idea team plan
    Idea,
    /// Pre-seed team plan
    PreSeed,
    /// Seed team plan
    Seed,
    /// Series A team plan
    SeriesA,
    /// Growth team plan
    Growth,
}

impl TeamPlan {
    /// Get the seat cap associated with a team plan
    pub fn seat_cap(&self) -> i32 {
        match self {
            TeamPlan::Idea => 3,
            TeamPlan::PreSeed => 6,
            TeamPlan::Seed => 10,
            TeamPlan::SeriesA => 25,
            TeamPlan::Growth => i32::MAX,
        }
    }
}

#[derive(
    Eq,
    PartialEq,
    Debug,
    Clone,
    PartialOrd,
    Copy,
    std::cmp::Ord,
    serde::Serialize,
    serde::Deserialize,
)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "\"team_role\"", rename_all = "lowercase")
)]
#[serde(rename_all = "lowercase")]
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

/// Current and invited members for a team.
#[derive(Debug, Clone, serde::Serialize)]
pub struct TeamMembers {
    /// Current accepted members of the team.
    pub members: Vec<TeamMember<'static>>,
    /// Pending invites for the team.
    pub invited: Vec<TeamInviteDetails>,
}

/// Request body for `PATCH /team/crm`.
#[derive(Debug, Clone, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchTeamCrmSettingsRequest {
    /// The desired CRM state for the team.
    pub enabled: bool,
}

/// Response for `PATCH /team/crm`. Reports both the resulting state
/// and whether this call changed it; for the enable-flip case it also
/// reports the backfill fan-out tallies.
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchTeamCrmSettingsResponse {
    /// The resulting `crm_enabled` value after the call.
    pub enabled: bool,
    /// True if this call flipped the value (false → true or true →
    /// false). False if the team was already at the requested state.
    pub changed: bool,
    /// Number of members for whom a `PopulateCrmForUser` message was
    /// enqueued. Non-zero only on a disabled → enabled transition;
    /// per-user enqueue failures are logged and swallowed.
    pub backfill_enqueued: usize,
    /// Number of members whose enqueue failed (and was swallowed).
    /// Non-zero only on a disabled → enabled transition.
    pub backfill_failed: usize,
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
    /// The new slug for the team. This is normalized to SCREAMING_SNAKE_CASE.
    pub slug: Option<String>,
    /// Role updates to apply to team users
    pub user_role_updates: Option<Vec<PatchTeamUserRole>>,
}

/// Request to update the team plan
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchTeamPlanRequest {
    /// The new team plan
    pub team_plan: TeamPlan,
}

/// Request to update a team user's role
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct PatchTeamUserRole {
    /// The team user you are updating
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub team_user_id: MacroUserIdStr<'static>,
    /// The new role of the team user
    pub role: TeamRole,
}

/// Team checkout session metadata
#[derive(Debug, Default, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamCheckoutSessionMetadata {
    /// Google Analytics client ID for conversion tracking
    pub ga_client_id: Option<String>,
    /// Meta (Facebook) browser ID from _fbp cookie
    pub fbp: Option<String>,
    /// Meta (Facebook) click ID from _fbc cookie
    pub fbc: Option<String>,
}

/// Team checkout session request
#[derive(Debug, serde::Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct TeamCheckoutSessionRequest {
    /// The URL to redirect to on successful checkout
    pub success_url: String,
    /// The URL to redirect to if checkout is cancelled
    pub cancel_url: String,
    /// Optional discount/promo code to apply
    pub discount: Option<String>,
    /// Tracking metadata for conversion attribution
    #[serde(default)]
    pub metadata: TeamCheckoutSessionMetadata,
    /// The team plan the user wants to purchase for their team
    pub team_plan: TeamPlan,
}

/// The Team struct
#[derive(Debug, Clone, serde::Serialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct Team {
    pub(crate) id: uuid::Uuid,
    pub(crate) name: String,
    pub(crate) slug: String,
    #[cfg_attr(feature = "axum", schema(value_type = String))]
    pub(crate) owner_id: MacroUserIdStr<'static>,
}

impl Team {
    /// Creates a new Team
    pub fn new(
        id: uuid::Uuid,
        name: String,
        slug: String,
        owner_id: MacroUserIdStr<'static>,
    ) -> Self {
        Self {
            id,
            name,
            slug,
            owner_id,
        }
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

    /// The slug of the team
    pub fn slug(&self) -> &str {
        &self.slug
    }

    /// The owner id of the team
    pub fn owner_id(&self) -> &str {
        self.owner_id.as_ref()
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

/// Snapshot of a team invite before it is accepted.
#[derive(Debug, Clone)]
pub struct TeamInviteSnapshot<'a> {
    /// The invite id
    pub id: uuid::Uuid,
    /// The team id
    pub team_id: uuid::Uuid,
    /// The invited email
    pub email: Email<Lowercase<'a>>,
    /// The role being invited as
    pub team_role: TeamRole,
    /// The user who sent the invitation
    pub invited_by: MacroUserIdStr<'a>,
    /// When the invite was created
    pub created_at: DateTime<Utc>,
    /// When the invite was last sent
    pub last_sent_at: DateTime<Utc>,
}

/// Result of accepting a team invite, including the data needed to roll it back.
#[derive(Debug, Clone)]
pub struct AcceptedTeamInvite<'a> {
    /// The accepted team member
    pub member: TeamMember<'a>,
    /// Snapshot of the invite before it was accepted
    pub invite: TeamInviteSnapshot<'a>,
}

/// Errors for team
#[derive(Debug, thiserror::Error)]
pub enum TeamError {
    /// The team does not exist
    #[error("The team does not exist")]
    TeamDoesNotExist,
    /// Team member was not found
    #[error("Team member not found for team {0}")]
    TeamMemberNotFound(uuid::Uuid),
    /// The subscription does not exist
    #[error("No subscription")]
    NoSubscription,
    /// The team subscription id is invalid
    #[error("Invalid subscription id")]
    InvalidSubscriptionId,
    /// The team invite does not exist
    #[error("The team invite does not exist")]
    TeamInviteDoesNotExist,
    /// Underlying entity access error
    #[error("Access error")]
    AccessError(#[from] entity_access::domain::models::AccessError),
    /// Bad request
    #[error("Bad request: {0}")]
    BadRequest(String),
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
    /// Not enough open seats
    #[error("Not enough open seats")]
    NotEnoughOpenSeats,
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
    /// Invalid promotion code
    #[error("Invalid promotion code {0}")]
    InvalidPromotionCode(String),
    /// No subscription line item matched the configured Stripe price id.
    #[error("No matching line item")]
    NoMatchingLineItem,
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

/// Error when restoring permissions for team members
#[derive(Debug, thiserror::Error)]
pub enum RestorePermissionsForTeamMembersError {
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// Underlying user roles and permissions error
    #[error("Underlying user roles and permissions error")]
    AddRolesToUserError(#[from] UserRolesAndPermissionsError),
}

/// Error when creating team checkout
#[derive(Debug, thiserror::Error)]
pub enum TeamCheckoutError {
    /// Team already has a plan
    #[error("Team already has a plan")]
    TeamAlreadyHasPlanError,
    /// Missing customer id
    #[error("User does not have a customer id")]
    MissingCustomerId,
    /// Underlying team error
    #[error("{0}")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("{0}")]
    CustomerError(#[from] CustomerError),
    /// Customer already has a subscription
    #[error("User already has an active subscription")]
    AlreadySubscribed,
}
