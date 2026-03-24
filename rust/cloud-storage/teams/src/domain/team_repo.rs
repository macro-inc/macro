//! Contains the domain logic for teams

use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};

use crate::domain::model::{
    CreateTeamError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError, PatchTeamRequest,
    ReinviteError, RemoveTeamInviteError, RemoveUserFromTeamError,
    RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamInviteDetails,
    TeamMember, TeamRole, TeamWithMembers,
};

/// The TeamChannelsRepository defines a set of actions related to team channels
pub trait TeamChannelsRepository: Clone + Send + Sync + 'static {
    /// Adds a team member to all team channels
    fn add_team_member_to_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Removes a team member from all team channels
    fn remove_team_member_from_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;
}

/// The TeamRepository defines a set of actions to perform on teams data
pub trait TeamRepository: Clone + Send + Sync + 'static {
    /// Gets the stripe customer id for a user
    fn get_stripe_customer_id(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<stripe::CustomerId>, TeamError>> + Send;

    /// Gets the subscription id for a team
    fn get_team_subscription_id(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<stripe::SubscriptionId>, TeamError>> + Send;

    /// Creates a new team
    fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send;

    /// Invites users to a team.
    /// This will also handle the teams subscription.
    /// Returns the number of users invited.
    fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Removes user from a team.
    fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
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
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'static>, TeamError>> + Send;

    /// Checks if a user is a member (not owner) of any team
    fn is_user_member_of_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
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
        users: non_empty::NonEmpty<&[MacroUserIdStr<'_>]>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'_>>, TeamError>> + Send;

    /// Gets a team by id with all its members
    fn get_team_by_id(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send;

    /// Gets all teams for a user
    fn get_user_teams(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Team>, TeamError>> + Send;

    /// Gets all team invites for a user (by email)
    fn get_user_team_invites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send;

    /// Gets all invites for a team
    fn get_team_invites(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send;

    /// Gets the name of a team
    fn get_team_name(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<String, TeamError>> + Send;

    /// Updates a team
    fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Gets detailed info about a team invite by id
    fn get_team_invite_details_by_id(
        &self,
        invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamInviteDetails, TeamError>> + Send;

    /// Updates the last_sent_at field of a team invite
    fn update_team_invite_last_sent_at(
        &self,
        invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Gets the role of a user in a team
    fn get_team_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamRole>, TeamError>> + Send;
}

/// The TeamService defines a set of actions to perform on the teams
pub trait TeamService: Clone + Send + Sync + 'static {
    /// Creates a new team
    fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
    ) -> impl Future<Output = Result<Team, CreateTeamError>> + Send;

    /// Invites users to a team
    /// This will also handle the teams subscription.
    /// Returns the team invites created.
    fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Remove user from a team.
    fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), RemoveUserFromTeamError>> + Send;

    /// Rejects an invitation to join a team.
    fn reject_invitation(
        &self,
        user_id: &MacroUserIdStr<'_>,
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
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'_>, JoinTeamError>> + Send;

    /// Revokes permissions for all team members (not owner)
    /// This is used when a team subscription is canceled or frozen in some way.
    fn revoke_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RevokePermissionsForTeamMembersError>> + Send;

    /// Gets a team by id with all its members
    fn get_team(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<TeamWithMembers, TeamError>> + Send;

    /// Gets all teams for a user
    fn get_user_teams(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<Team>, TeamError>> + Send;

    /// Gets all team invites for the authenticated user
    fn get_user_invites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send;

    /// Gets all invites for a team
    fn get_team_invites(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send;

    /// Updates a team
    fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Reinvites a user to a team (rate-limited to 5 min)
    fn reinvite_to_team(
        &self,
        team_invite_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamInviteDetails, ReinviteError>> + Send;

    /// Gets the role of a user in a team
    fn get_team_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamRole>, TeamError>> + Send;
}
