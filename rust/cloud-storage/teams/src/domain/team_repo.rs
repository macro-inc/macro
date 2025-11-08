//! Contains the domain logic for teams

use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::model::{
    CreateTeamError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError, RemoveTeamInviteError,
    RemoveUserFromTeamError, RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite,
    TeamMember,
};

/// The TeamRepository defines a set of actions to perform on teams data
pub trait TeamRepository: Clone + Send + Sync + 'static {
    /// Gets the stripe customer id for a user
    fn get_stripe_customer_id(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Option<stripe::CustomerId>, TeamError>> + Send;

    /// Gets the subscription id for a team
    fn get_team_subscription_id(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<stripe::SubscriptionId>, TeamError>> + Send;

    /// Creates a new team
    fn create_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_name: &str,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send;

    /// Invites users to a team.
    /// This will also handle the teams subscription.
    /// Returns the number of users invited.
    fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserId<Lowercase<'_>>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Removes user from a team.
    fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<(), RemoveUserFromTeamError>> + Send;

    ///Gets a team invite by id
    fn get_team_invite_by_id(
        &self,
        team_invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamInvite<'_>, TeamError>> + Send;

    /// Deletes a team invite from a team.
    fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RemoveTeamInviteError>> + Send;

    /// Updates a team subscription id
    fn update_team_subscription(
        &self,
        team_id: &uuid::Uuid,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Deletes a team
    fn delete_team(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Gets all members of a team including the owner
    fn get_all_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamMember<'_>>, TeamError>> + Send;

    /// Accepts a team invite for a user
    fn accept_team_invite(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<TeamMember<'static>, TeamError>> + Send;

    /// Checks if a user is a member (not owner) of any team
    fn is_user_member_of_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send;

    /// Gets the members of the team.
    /// This does not include the team owner.
    fn get_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamMember<'_>>, TeamError>> + Send;

    /// Checks if a list of users are members of any team that is not in the
    /// provided list of ignore_team_ids.
    /// Returns a list of MacroUserId for all users that are members of another team.
    fn bulk_is_member_of_other_team(
        &self,
        ignore_team_ids: non_empty::NonEmpty<&[uuid::Uuid]>,
        users: non_empty::NonEmpty<&[MacroUserId<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<MacroUserId<Lowercase<'_>>>, TeamError>> + Send;
}

/// The TeamService defines a set of actions to perform on the teams
pub trait TeamService: Clone + Send + Sync + 'static {
    /// Creates a new team
    fn create_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_name: &str,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send;

    /// Invites users to a team
    /// This will also handle the teams subscription.
    /// Returns the team invites created.
    fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserId<Lowercase<'_>>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Remove user from a team.
    fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<(), RemoveUserFromTeamError>> + Send;

    /// Rejects an invitation to join a team.
    fn reject_invitation(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RemoveTeamInviteError>> + Send;

    /// Deletes a team invite from a team.
    fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RemoveTeamInviteError>> + Send;

    /// Cancels the team subscription and deletes the team.
    fn delete_team(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), DeleteTeamError>> + Send;

    /// Accepts a team invite for a user
    fn join_team(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<TeamMember<'_>, JoinTeamError>> + Send;

    /// Revokes permissions for all team members (not owner)
    /// This is used when a team subscription is canceled or frozen in some way.
    fn revoke_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RevokePermissionsForTeamMembersError>> + Send;
}
