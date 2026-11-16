//! Errors of the team domain.

use super::*;

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
    /// The team is not paying
    #[error("The team is not paying")]
    TeamNotPaying,
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
    /// The user is already on a team; a user can be on at most one.
    #[error("the user is already on a team")]
    AlreadyOnTeam,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for inviting users to team
#[derive(Debug, thiserror::Error)]
pub enum InviteUsersToTeamError {
    /// The team has hit its daily limit on new invites
    #[error("the team has sent too many invites today")]
    TooManyEmails,
    /// The team only allows admins to invite and the caller is not an admin
    #[error("only team admins may invite users to this team")]
    NonAdminInvitesDisabled,
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
    /// The member is an agent teammate: removing it as a person would leave
    /// its computer billing and its keys working.
    #[error("agent teammates are removed with the team agents removal, not as members")]
    AgentTeammate,
    /// Team error
    #[error("Team error")]
    TeamError(#[from] TeamError),
    /// There is no subscription for the team
    #[error("There is no subscription for the team")]
    NoSubscription,
    /// Underlying customer error
    #[error("Underlying customer error {0}")]
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
    /// The removed member's open seat could not be released, and the removal was rolled back.
    #[error("failed to release the removed member's open seat")]
    OpenSeatRelease(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// The member's seat is billed, so it cannot be taken back as an included one.
    #[error("The member's seat is not included")]
    SeatNotIncluded,
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
    /// The subscription is neither active nor trialing
    #[error("Subscription is not active")]
    SubscriptionNotActive,
    /// Invalid promotion code
    #[error("Invalid promotion code {0}")]
    InvalidPromotionCode(String),
    /// No subscription line item matched the configured Stripe price id.
    #[error("No matching line item")]
    NoMatchingLineItem,
    /// The plan has no Stripe price configured.
    #[error("The {0} plan is not available")]
    PlanUnavailable(SeatPlan),
    /// The payment for an item change was declined or needs customer action.
    /// Nothing changed on the subscription.
    #[error("The payment did not go through")]
    PaymentFailed,
    /// An item change would leave a price with a negative quantity.
    #[error("Price {0} has fewer items than the change removes")]
    QuantityBelowZero(String),
    /// The item change was given up after its outcome stayed unknown; it is
    /// never sent again.
    #[error("The item change was abandoned")]
    ItemChangeAbandoned,
    /// Another change to this subscription was sent moments ago and may
    /// still be in flight at the provider; try again shortly.
    #[error("another subscription change is still in flight")]
    ItemChangeInFlight,
    /// A computer item cannot be added while the subscription is trialing:
    /// computers are for paying teams.
    #[error("the subscription is trialing")]
    SubscriptionTrialing,
    /// Storage layer error
    #[error("Storage layer error {0}")]
    StorageLayerError(#[from] anyhow::Error),
}

/// Errors for moving a team member between seat plans.
#[derive(Debug, thiserror::Error)]
pub enum SetTeamMemberPlanError {
    /// Seat plans only apply to paying (or enterprise) teams.
    #[error("The team has no active subscription")]
    TeamNotPaying,
    /// Underlying team error
    #[error("{0}")]
    TeamError(#[from] TeamError),
    /// Underlying customer error
    #[error("{0}")]
    CustomerError(#[from] CustomerError),
    /// Usage could not be reset for the upgraded seat.
    #[error("failed to update seat usage after a plan change")]
    UsageReset(#[source] Box<dyn std::error::Error + Send + Sync>),
    /// Roles could not be updated
    #[error("Roles error: {0}")]
    RolesError(#[from] UserRolesAndPermissionsError),
    /// The member's seat is included and never billed, so it has no plan to change.
    #[error("The member's seat is included and has no paid plan")]
    SeatIncluded,
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
    #[error("Underlying customer error {0}")]
    CustomerError(#[from] CustomerError),
    /// Remove roles from user error
    #[error("Remove roles from user error")]
    RemoveRolesFromUserError(#[from] UserRolesAndPermissionsError),
    /// The team's content could not be purged, so the team was not deleted
    #[error("unable to purge the team's content")]
    OwnedEntityCleanup(#[from] OwnedEntityCleanupError),
}

/// Errors for detaching a user from every team ahead of account deletion
#[derive(Debug, thiserror::Error)]
pub enum RemoveUserFromAllTeamsError {
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// A team the user owns could not be deleted
    #[error("Unable to delete a team the user owns")]
    DeleteTeam(#[from] DeleteTeamError),
    /// The user could not be removed from a team they belong to
    #[error("Unable to remove the user from a team")]
    RemoveUserFromTeam(#[from] RemoveUserFromTeamError),
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
    #[error("Underlying customer error {0}")]
    CustomerError(#[from] CustomerError),
    /// The user was not invited to the team
    #[error("User not invited")]
    UserNotInvited,
    #[error("Underlying user roles and permissions error")]
    /// Underlying user roles and permissions error
    AddRolesToUserError(#[from] UserRolesAndPermissionsError),
}

/// Errors for toggling a team's auto-join domain
#[derive(Debug, thiserror::Error)]
pub enum ToggleAutoJoinDomainError {
    /// The team owner's email domain is a generic email provider domain
    #[error("Auto-join isn't available for {0}")]
    GenericDomainNotAllowed(String),
    /// Underlying team error
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
}

/// Errors for adding a user to a team without an email invite: by matching
/// the team's auto-join domain, or through the team's invite link.
#[derive(Debug, thiserror::Error)]
pub enum JoinTeamDirectlyError {
    /// Underlying team error
    #[error("Underlying team error {0}")]
    TeamError(#[from] TeamError),
    /// Underlying join team error
    #[error("Underlying join team error {0}")]
    JoinTeamError(#[from] JoinTeamError),
    /// The user is already a member of the team.
    #[error("The user is already a member of the team")]
    AlreadyMember,
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
    /// Provider renewal state could not be read or acknowledged.
    #[error(transparent)]
    Customer(#[from] CustomerError),
    /// Underlying team error
    #[error("Underlying team error")]
    TeamError(#[from] TeamError),
    /// Underlying user roles and permissions error
    #[error("Underlying user roles and permissions error")]
    AddRolesToUserError(#[from] UserRolesAndPermissionsError),
    /// Initial seat upgrade usage could not be reset; retry activation.
    #[error("failed to reset usage for an activated team seat")]
    UsageReset(#[source] Box<dyn std::error::Error + Send + Sync>),
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
