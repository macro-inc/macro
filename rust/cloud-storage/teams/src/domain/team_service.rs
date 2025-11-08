//! Contains the service logic for teams

use std::{collections::HashSet, str::FromStr};

use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserId};
use roles_and_permissions::domain::{model::RoleId, port::UserRolesAndPermissionsService};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{
        CreateSubscriptionArgs, CreateTeamError, CustomerError, DeleteTeamError,
        InviteUsersToTeamError, JoinTeamError, RemoveTeamInviteError, RemoveUserFromTeamError,
        RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamMember,
    },
    team_repo::{TeamRepository, TeamService},
};

/// Implementation of the TeamService using a TeamRepository
#[derive(Debug, Clone)]
pub struct TeamServiceImpl<TR, CR, URPS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    URPS: UserRolesAndPermissionsService,
{
    /// The underlying team repository
    team_repository: TR,
    /// The underlying customer repository
    customer_repository: CR,
    /// The underlying user roles and permissions service
    user_roles_and_permissions_service: URPS,
}

impl<TR, CR, URPS> TeamServiceImpl<TR, CR, URPS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    URPS: UserRolesAndPermissionsService,
{
    /// Creates a new TeamService
    pub fn new(
        team_repository: TR,
        customer_repository: CR,
        user_roles_and_permissions_service: URPS,
    ) -> Self {
        Self {
            team_repository,
            customer_repository,
            user_roles_and_permissions_service,
        }
    }
}

impl<TR, CR, URPS> TeamService for TeamServiceImpl<TR, CR, URPS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    URPS: UserRolesAndPermissionsService,
{
    async fn create_team(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_name: &str,
    ) -> Result<Team, CreateTeamError> {
        self.team_repository.create_team(user_id, team_name).await
    }

    async fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserId<Lowercase<'_>>,
        emails: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        let invited = self
            .team_repository
            .invite_users_to_team(team_id, invited_by, emails)
            .await?;

        if !invited.is_empty() {
            let subscription_id = self
                .team_repository
                .get_team_subscription_id(team_id)
                .await?;

            // Increase the quantity of the subscription
            if let Some(subscription_id) = subscription_id {
                let subscription_id = stripe::SubscriptionId::from_str(&subscription_id)
                    .map_err(|e| InviteUsersToTeamError::StorageLayerError(e.into()))?;

                // Increment the quantity of the subscription by the number of emails
                self.customer_repository
                    .increase_subscription_quantity(&subscription_id, invited.len() as u64)
                    .await?;
            } else {
                // Create new subscription
                let customer_id = self
                    .team_repository
                    .get_stripe_customer_id(invited_by)
                    .await?
                    .ok_or(InviteUsersToTeamError::CustomerError(
                        CustomerError::NoStripeCustomerId,
                    ))?;

                let subscription_id = self
                    .customer_repository
                    .create_subscription(CreateSubscriptionArgs {
                        customer_id,
                        price_id: "price_1PnSgXJaD7zvQeOBfSYgOmZc",
                        quantity: invited.len() as u64,
                        metadata: Some(
                            vec![
                                ("team_id".to_string(), team_id.to_string()),
                                ("owner_id".to_string(), invited_by.as_ref().to_string()),
                            ]
                            .into_iter()
                            .collect(),
                        ),
                    })
                    .await?;

                // Update team with the new subscription id
                self.team_repository
                    .update_team_subscription(team_id, &subscription_id)
                    .await?;
            }
        }

        Ok(invited)
    }

    async fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let result = self
            .team_repository
            .remove_user_from_team(team_id, user_id)
            .await;

        // The user was part of the team and was removed
        if result.is_ok() {
            let subscription_id = self
                .team_repository
                .get_team_subscription_id(team_id)
                .await?;

            if let Some(subscription_id) = subscription_id {
                // Decrement the quantity of the subscription
                self.customer_repository
                    .decrease_subscription_quantity(&subscription_id, 1)
                    .await?;
            } else {
                return Err(RemoveUserFromTeamError::NoSubscription);
            }
        }

        if !self.team_repository.is_user_member_of_team(user_id).await? {
            let roles = vec![RoleId::TeamSubscriber];
            let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();
            self.user_roles_and_permissions_service
                .dangerous_remove_roles_from_user(user_id, &roles)
                .await
                .map_err(RemoveUserFromTeamError::RemoveRolesFromUserError)?;
        }

        result
    }

    async fn reject_invitation(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        let team_invite = self
            .team_repository
            .get_team_invite_by_id(team_invite_id)
            .await?;

        if team_invite.email.as_ref() != user_id.email_part().as_ref() {
            return Err(RemoveTeamInviteError::UserNotInTeam);
        }

        self.team_repository
            .delete_team_invite(&team_invite.team_id, team_invite_id)
            .await?;

        let subscription_id = self
            .team_repository
            .get_team_subscription_id(&team_invite.team_id)
            .await?;

        if let Some(subscription_id) = subscription_id {
            // Decrement the quantity of the subscription
            self.customer_repository
                .decrease_subscription_quantity(&subscription_id, 1)
                .await?;
        } else {
            return Err(TeamError::NoSubscription.into());
        }

        Ok(())
    }

    async fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        self.team_repository
            .delete_team_invite(team_id, team_invite_id)
            .await?;

        let subscription_id = self
            .team_repository
            .get_team_subscription_id(team_id)
            .await?;

        if let Some(subscription_id) = subscription_id {
            // Decrement the quantity of the subscription
            self.customer_repository
                .decrease_subscription_quantity(&subscription_id, 1)
                .await?;
        } else {
            return Err(TeamError::NoSubscription.into());
        }

        Ok(())
    }

    async fn delete_team(&self, team_id: &uuid::Uuid) -> Result<(), DeleteTeamError> {
        let members = self.team_repository.get_all_team_members(team_id).await?;

        let subscription_id = self
            .team_repository
            .get_team_subscription_id(team_id)
            .await?;

        if let Some(subscription_id) = subscription_id {
            // Cancel subscription
            let subscription_id =
                stripe::SubscriptionId::from_str(&subscription_id).map_err(|_| {
                    DeleteTeamError::StorageLayerError(anyhow::anyhow!("Invalid subscription id"))
                })?;

            self.customer_repository
                .cancel_subscription(&subscription_id)
                .await
                .map_err(DeleteTeamError::CustomerError)?;
        }

        self.team_repository
            .delete_team(team_id)
            .await
            .map_err(DeleteTeamError::TeamError)?;

        // Remove roles for team members
        let roles = vec![RoleId::TeamSubscriber];
        let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();

        // TODO: speed this up
        for member in members {
            if !self
                .team_repository
                .is_user_member_of_team(&member.user_id)
                .await?
            {
                self.user_roles_and_permissions_service
                    .dangerous_remove_roles_from_user(&member.user_id, &roles)
                    .await
                    .map_err(DeleteTeamError::RemoveRolesFromUserError)?;
            }
        }

        Ok(())
    }

    async fn join_team(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<TeamMember<'_>, JoinTeamError> {
        let team_member = self
            .team_repository
            .accept_team_invite(team_invite_id, user_id)
            .await
            .map_err(JoinTeamError::TeamError)?;

        // subscribe the user to professional features from the TeamSubscriber role
        let roles = vec![RoleId::TeamSubscriber];
        let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();

        self.user_roles_and_permissions_service
            .dangerous_upsert_roles_for_user(user_id, roles)
            .await
            .map_err(JoinTeamError::AddRolesToUserError)?;

        Ok(team_member)
    }

    async fn revoke_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<(), RevokePermissionsForTeamMembersError> {
        let members = self.team_repository.get_team_members(team_id).await?;

        if members.is_empty() {
            return Ok(());
        }

        let members: Vec<MacroUserId<Lowercase<'_>>> =
            members.into_iter().map(|m| m.user_id).collect();

        // Ignore the current team
        let ignore_team_ids = vec![*team_id];

        let members_of_team = self
            .team_repository
            .bulk_is_member_of_other_team(
                non_empty::NonEmpty::new(ignore_team_ids.as_slice()).unwrap(),
                non_empty::NonEmpty::new(members.as_slice()).unwrap(),
            )
            .await?;

        let members_of_team: HashSet<&str> = members_of_team.iter().map(|m| m.as_ref()).collect();
        // Get all members that are not in the other team
        let members_to_revoke: Vec<MacroUserId<Lowercase<'_>>> = members
            .into_iter()
            .filter(|m| !members_of_team.contains(m.as_ref()))
            .collect();

        // Revoke permissions for all members
        let roles = vec![RoleId::TeamSubscriber];
        let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();
        for member in members_to_revoke {
            self.user_roles_and_permissions_service
                .dangerous_remove_roles_from_user(&member, &roles)
                .await
                .map_err(RevokePermissionsForTeamMembersError::RemoveRolesFromUserError)?;
        }

        Ok(())
    }
}
