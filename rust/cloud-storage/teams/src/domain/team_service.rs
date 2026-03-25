//! Contains the service logic for teams

use std::{collections::HashSet, str::FromStr, sync::Arc};

use macro_user_id::{
    cowlike::CowLike, email::Email, lowercased::Lowercase, user_id::MacroUserIdStr,
};
use roles_and_permissions::domain::{model::RoleId, port::UserRolesAndPermissionsService};

#[cfg(feature = "ports")]
use model_entity::EntityType;
#[cfg(feature = "ports")]
use model_notifications::InviteToTeamMetadata;
#[cfg(feature = "ports")]
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};

use crate::domain::{
    customer_repo::CustomerRepository,
    model::{
        CreateSubscriptionArgs, CreateTeamError, CustomerError, DeleteTeamError,
        InviteUsersToTeamError, JoinTeamError, PatchTeamRequest, ReinviteError,
        RemoveTeamInviteError, RemoveUserFromTeamError, RevokePermissionsForTeamMembersError, Team,
        TeamError, TeamInvite, TeamInviteDetails, TeamMember, TeamRole, TeamWithMembers,
    },
    team_repo::{TeamChannelsRepository, TeamRepository, TeamService},
};

/// Implementation of the TeamService using a TeamRepository
#[derive(Debug)]
pub struct TeamServiceImpl<TR, CR, TCR, URPS, NI>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
{
    /// The underlying team repository
    team_repository: TR,
    /// The underlying customer repository
    customer_repository: CR,
    /// The team channels repository
    team_channels_repository: TCR,
    /// The underlying user roles and permissions service
    user_roles_and_permissions_service: URPS,
    /// The notification ingress service
    notification_ingress: Arc<NI>,
}

impl<TR, CR, TCR, URPS, NI> Clone for TeamServiceImpl<TR, CR, TCR, URPS, NI>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
{
    fn clone(&self) -> Self {
        Self {
            team_repository: self.team_repository.clone(),
            customer_repository: self.customer_repository.clone(),
            team_channels_repository: self.team_channels_repository.clone(),
            user_roles_and_permissions_service: self.user_roles_and_permissions_service.clone(),
            notification_ingress: self.notification_ingress.clone(),
        }
    }
}

impl<TR, CR, TCR, URPS, NI> TeamServiceImpl<TR, CR, TCR, URPS, NI>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
{
    /// Creates a new TeamService
    pub fn new(
        team_repository: TR,
        customer_repository: CR,
        team_channels_repository: TCR,
        user_roles_and_permissions_service: URPS,
        notification_ingress: Arc<NI>,
    ) -> Self {
        Self {
            team_repository,
            customer_repository,
            team_channels_repository,
            user_roles_and_permissions_service,
            notification_ingress,
        }
    }
}

impl<TR, CR, TCR, URPS, NI> TeamServiceImpl<TR, CR, TCR, URPS, NI>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
{
    /// Sends an invite notification for a team invite
    async fn send_invite_notification(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
        email: &str,
        team_name: &str,
        invited_by: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<()> {
        let notification = InviteToTeamMetadata {
            invited_by: invited_by.clone(),
            team_name: team_name.to_string(),
            team_id: team_id.to_string(),
            role: None,
        };

        let recipient = MacroUserIdStr::try_from_email(email)
            .map_err(|e| anyhow::anyhow!("failed to parse email as macro user id: {}", e))?;

        let entity_id = team_invite_id.to_string();
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team.with_entity_str(&entity_id),
            notification,
            sender_id: Some(invited_by.clone()),
            recipient_ids: HashSet::from([recipient]),
        }
        .into_request()
        .with_conn_gateway();

        self.notification_ingress
            .send_notification(request)
            .await
            .map_err(|e| anyhow::anyhow!("failed to send notification: {}", e))?;

        Ok(())
    }
}

impl<TR, CR, TCR, URPS, NI> TeamService for TeamServiceImpl<TR, CR, TCR, URPS, NI>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
{
    async fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
    ) -> Result<Team, CreateTeamError> {
        self.team_repository.create_team(user_id, team_name).await
    }

    async fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
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

        // Send notifications for new invites
        if !invited.is_empty() {
            let team_name = self.team_repository.get_team_name(team_id).await.ok();

            if let Some(team_name) = team_name {
                let invited_by_owned = invited_by.clone().into_owned();
                for invite in &invited {
                    self.send_invite_notification(
                        team_id,
                        &invite.team_invite_id,
                        invite.email.as_ref(),
                        &team_name,
                        &invited_by_owned,
                    )
                    .await
                    .inspect_err(
                        |e| tracing::error!(error=?e, "unable to send invite notification"),
                    )
                    .ok();
                }
            }
        }

        Ok(invited)
    }

    async fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let result = self
            .team_repository
            .remove_user_from_team(team_id, user_id)
            .await;

        // The user was part of the team and was removed
        if result.is_ok() {
            self.team_channels_repository
                .remove_team_member_from_channels(team_id, user_id)
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
        user_id: &MacroUserIdStr<'_>,
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
        user_id: &MacroUserIdStr<'_>,
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

        self.team_channels_repository
            .add_team_member_to_channels(&team_member.team_id, user_id)
            .await?;

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

        let members: Vec<MacroUserIdStr<'_>> = members.into_iter().map(|m| m.user_id).collect();

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
        let members_to_revoke: Vec<_> = members
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

    async fn get_team(&self, team_id: &uuid::Uuid) -> Result<TeamWithMembers, TeamError> {
        self.team_repository.get_team_by_id(team_id).await
    }

    async fn get_user_teams(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<Team>, TeamError> {
        self.team_repository.get_user_teams(user_id).await
    }

    async fn get_user_invites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        self.team_repository.get_user_team_invites(user_id).await
    }

    async fn get_team_invites(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        self.team_repository.get_team_invites(team_id).await
    }

    async fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> Result<(), TeamError> {
        self.team_repository.patch_team(team_id, req).await
    }

    async fn reinvite_to_team(
        &self,
        team_invite_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
    ) -> Result<TeamInviteDetails, ReinviteError> {
        let invite = self
            .team_repository
            .get_team_invite_details_by_id(team_invite_id)
            .await
            .map_err(|e| match e {
                TeamError::TeamInviteDoesNotExist => ReinviteError::InviteNotFound,
                other => ReinviteError::StorageLayerError(other.into()),
            })?;

        // Rate limit: must wait 5 minutes between reinvites
        let five_minutes_ago = chrono::Utc::now() - chrono::Duration::minutes(5);
        if invite.last_sent_at > five_minutes_ago {
            return Err(ReinviteError::TooManyRequests);
        }

        self.team_repository
            .update_team_invite_last_sent_at(team_invite_id)
            .await
            .map_err(|e| ReinviteError::StorageLayerError(e.into()))?;

        // Send notification
        let team_name = self
            .team_repository
            .get_team_name(&invite.team_id)
            .await
            .map_err(|e| ReinviteError::StorageLayerError(e.into()))?;

        let invited_by = invited_by.clone().into_owned();
        self.send_invite_notification(
            &invite.team_id,
            team_invite_id,
            &invite.email,
            &team_name,
            &invited_by,
        )
        .await
        .inspect_err(|e| tracing::error!(error=?e, "unable to send reinvite notification"))
        .ok();

        Ok(invite)
    }

    async fn get_team_role(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamRole>, TeamError> {
        self.team_repository.get_team_role(team_id, user_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_user_permissions(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<roles_and_permissions::domain::model::PermissionId>, TeamError> {
        self.user_roles_and_permissions_service
            .get_user_permissions(user_id)
            .await
            .map_err(|e| TeamError::StorageLayerError(e.into()))
    }
}
