//! Contains the domain logic for teams

use std::collections::HashSet;

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, MemberTeamRole, OwnerTeamRole,
};
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};

use crate::domain::model::{
    AcceptedTeamInvite, CreateTeamError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError,
    PatchTeamPlanRequest, PatchTeamRequest, RemoveTeamInviteError, RemoveUserFromTeamError,
    RestorePermissionsForTeamMembersError, RevokePermissionsForTeamMembersError, Team,
    TeamCheckoutError, TeamCheckoutSessionRequest, TeamError, TeamInvite, TeamInviteDetails,
    TeamMember, TeamMembers, TeamPlan, TeamRole, TeamWithMembers,
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

    /// Checks if a user has already used a trial.
    fn has_user_trialed(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<bool, TeamError>> + Send;

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
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Compares the list of users you are trying to invite to ones already invited
    /// to return a list of emails who will be newly invited
    fn get_new_invites(
        &self,
        team_id: &uuid::Uuid,
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<Email<Lowercase<'static>>>, InviteUsersToTeamError>> + Send;

    /// Marks the given team invites as sent by updating their last_sent_at timestamp.
    fn mark_invites_sent(
        &self,
        invite_ids: &[uuid::Uuid],
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Removes user from a team.
    fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'static>, RemoveUserFromTeamError>> + Send;

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

    /// Accepts a team invite for a user.
    ///
    /// Returns the accepted member and a snapshot of the invite so the operation can be rolled
    /// back if a later customer/billing side effect fails.
    fn accept_team_invite(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<AcceptedTeamInvite<'static>, TeamError>> + Send;

    /// Rolls back a previously accepted team invite.
    fn rollback_accept_team_invite(
        &self,
        accepted_invite: &AcceptedTeamInvite<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Rolls back a previously removed team member.
    fn rollback_remove_user_from_team(
        &self,
        removed_member: &TeamMember<'_>,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

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

    /// Gets the role of a user in a team
    fn get_team_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<TeamRole>, TeamError>> + Send;

    /// Gets the team member for the team
    fn get_team_member(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'_>, TeamError>> + Send;

    /// Patches the role of the provided user id for the team
    fn patch_team_user_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        team_role: TeamRole,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Get the teams current seat count
    fn get_team_seat_count(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<i32, TeamError>> + Send;

    /// Gets the teams current plan
    fn get_team_plan(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Option<TeamPlan>, TeamError>> + Send;

    /// Patches the teams current plan
    fn patch_team_plan(
        &self,
        team_id: &uuid::Uuid,
        team_plan: TeamPlan,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;
}

/// The TeamMembersService defines read-only team membership queries.
pub trait TeamMembersService: Clone + Send + Sync + 'static {
    /// Lists current members and pending invites for a team.
    fn list_team_members(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> impl Future<Output = Result<TeamMembers, TeamError>> + Send;
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
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> impl Future<Output = Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError>> + Send;

    /// Remove user from a team.
    fn remove_user_from_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
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
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        team_invite_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RemoveTeamInviteError>> + Send;

    /// Cancels the team subscription and deletes the team.
    fn delete_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
    ) -> impl Future<Output = Result<(), DeleteTeamError>> + Send;

    /// Accepts a team invite for a user
    fn join_team(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<TeamMember<'_>, JoinTeamError>> + Send;

    /// Revokes permissions for all team members (not owner)
    /// This is used when a team subscription is canceled or frozen in some way.
    /// NOTE: this is not exposed via axum and is meant for internal usage within stripe webhook only.
    fn revoke_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RevokePermissionsForTeamMembersError>> + Send;

    /// Restores permissions for all team members.
    /// This is used when a team subscription becomes active again.
    /// NOTE: this is not exposed via axum and is meant for internal usage within stripe webhook only.   
    fn restore_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<(), RestorePermissionsForTeamMembersError>> + Send;

    /// Gets a team by id with all its members
    fn get_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
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
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> impl Future<Output = Result<Vec<TeamInviteDetails>, TeamError>> + Send;

    /// Updates a team
    fn patch_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        req: &PatchTeamRequest,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Gets the team users permissions
    fn get_team_user_permissions(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> impl Future<
        Output = Result<HashSet<roles_and_permissions::domain::model::PermissionId>, TeamError>,
    > + Send;

    /// Updates the teams plan
    fn update_team_plan(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        req: &PatchTeamPlanRequest,
    ) -> impl Future<Output = Result<(), TeamError>> + Send;

    /// Creates a checkout session for the initial team purchase
    /// This should only be called if the team currently is not on a plan
    /// Returns the checkout session url
    fn create_checkout_session(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        req: &TeamCheckoutSessionRequest,
    ) -> impl Future<Output = Result<String, TeamCheckoutError>> + Send;
}
