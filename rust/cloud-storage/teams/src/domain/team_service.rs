//! Contains the service logic for teams

#[cfg(test)]
mod test;

use std::{collections::HashSet, sync::Arc};

use anyhow::Context;
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
        AcceptedTeamInvite, CreateTeamError, CustomerError, DeleteTeamError,
        InviteUsersToTeamError, JoinTeamError, PatchTeamRequest, PatchTeamUserTierRequest,
        RemoveTeamInviteError, RemoveUserFromTeamError, RestorePermissionsForTeamMembersError,
        RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamInviteDetails,
        TeamMember, TeamRole, TeamUserTier, TeamWithMembers,
    },
    team_repo::{TeamChannelsRepository, TeamRepository, TeamService},
};

#[derive(Debug, thiserror::Error)]
enum GetTeamSubscriptionError {
    #[error(transparent)]
    Team(#[from] TeamError),
    #[error(transparent)]
    Customer(#[from] CustomerError),
    #[error(transparent)]
    Storage(#[from] anyhow::Error),
}

impl GetTeamSubscriptionError {
    fn into_join_team_error(self) -> JoinTeamError {
        match self {
            Self::Team(e) => JoinTeamError::TeamError(e),
            Self::Customer(e) => JoinTeamError::CustomerError(e),
            Self::Storage(e) => JoinTeamError::StorageLayerError(e),
        }
    }

    fn into_remove_user_from_team_error(self) -> RemoveUserFromTeamError {
        match self {
            Self::Team(e) => RemoveUserFromTeamError::TeamError(e),
            Self::Customer(e) => RemoveUserFromTeamError::CustomerError(e),
            Self::Storage(e) => RemoveUserFromTeamError::StorageLayerError(e),
        }
    }

    fn into_team_error(self) -> TeamError {
        match self {
            Self::Team(e) => e,
            Self::Customer(e) => TeamError::StorageLayerError(e.into()),
            Self::Storage(e) => TeamError::StorageLayerError(e),
        }
    }
}

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
    /// Gets the teams subscription id
    /// If the team doesn't have a subscription yet, it will convert the owners personal subscription into a team subscription
    #[tracing::instrument(skip(self), err)]
    async fn get_team_subscription(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<stripe::SubscriptionId, GetTeamSubscriptionError> {
        let subscription_id = self
            .team_repository
            .get_team_subscription_id(team_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?;

        // stripe subscription is already tracked for team
        if let Some(subscription_id) = subscription_id {
            return Ok(subscription_id);
        }

        tracing::info!("no subscription found for team");

        // Get the team to get owner
        let team = self
            .team_repository
            .get_team_by_id(team_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?;

        let customer_id = self
            .team_repository
            .get_stripe_customer_id(&team.team.owner_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?
            .context("expected customer id")?;

        let customer_subscription_id = self
            .customer_repository
            .get_subscription_id_for_customer(&customer_id)
            .await
            .map_err(GetTeamSubscriptionError::Customer)?;

        // Convert the customer's subscription to a team subscription before storing it locally,
        // so a customer failure cannot leave a local subscription_id pointing at an unconverted
        // personal subscription.
        self.customer_repository
            .convert_subscription_to_team(&customer_subscription_id, team_id, &team.team.owner_id)
            .await
            .map_err(GetTeamSubscriptionError::Customer)?;

        self.team_repository
            .update_team_subscription(team_id, &customer_subscription_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?;

        Ok(customer_subscription_id)
    }

    /// Sends an invite notification for a team invite
    #[tracing::instrument(skip(self), err)]
    async fn send_invite_notification(
        &self,
        recipient_id: MacroUserIdStr<'_>,
        team_invite_id: uuid::Uuid,
        notification: InviteToTeamMetadata,
    ) -> anyhow::Result<()> {
        let request = SendNotificationRequestBuilder {
            notification_entity: EntityType::Team.with_entity_string(team_invite_id.to_string()),
            sender_id: Some(notification.invited_by.clone()),
            notification,
            recipient_ids: HashSet::from([recipient_id]),
        }
        .into_request()
        .with_email()
        .with_conn_gateway();

        self.notification_ingress
            .send_notification(request)
            .await
            .map_err(|e| anyhow::anyhow!("failed to send notification: {}", e))?;

        Ok(())
    }

    #[tracing::instrument(skip(self, accepted_invite))]
    async fn rollback_join_team(
        &self,
        accepted_invite: &AcceptedTeamInvite<'_>,
        roles_added: bool,
        channels_added: bool,
    ) {
        if channels_added {
            self.team_channels_repository
                .remove_team_member_from_channels(
                    &accepted_invite.member.team_id,
                    &accepted_invite.member.user_id,
                )
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to roll back team channel membership after customer error"))
                .ok();
        }

        if roles_added {
            let roles_to_remove = vec![
                RoleId::TeamSubscriber,
                RoleId::from(accepted_invite.member.tier),
            ];
            self.user_roles_and_permissions_service
                .dangerous_remove_roles_from_user(
                    &accepted_invite.member.user_id,
                    &non_empty::NonEmpty::new(roles_to_remove.as_slice()).unwrap(),
                )
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to roll back team roles after customer error"))
                .ok();
        }

        self.team_repository
            .rollback_accept_team_invite(accepted_invite)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to roll back accepted team invite after customer error"))
            .ok();
    }

    #[tracing::instrument(skip(self, removed_member))]
    async fn rollback_remove_user_from_team(
        &self,
        removed_member: &TeamMember<'_>,
        channels_removed: bool,
    ) {
        self.team_repository
            .rollback_remove_user_from_team(removed_member)
            .await
            .inspect_err(|e| tracing::error!(error=?e, "failed to roll back removed team member after customer error"))
            .ok();

        if channels_removed {
            self.team_channels_repository
                .add_team_member_to_channels(&removed_member.team_id, &removed_member.user_id)
                .await
                .inspect_err(|e| tracing::error!(error=?e, "failed to restore team channel membership after customer error"))
                .ok();
        }
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
    #[tracing::instrument(skip(self), err)]
    async fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
    ) -> Result<Team, CreateTeamError> {
        let user_roles = self
            .user_roles_and_permissions_service
            .get_user_roles(user_id)
            .await
            .map_err(|e| CreateTeamError::StorageLayerError(e.into()))?;

        let team_user_tier =
            TeamUserTier::try_from_roles(user_roles).map_err(CreateTeamError::StorageLayerError)?;

        self.team_repository
            .create_team(user_id, team_name, &team_user_tier)
            .await
    }

    #[tracing::instrument(skip(self), err)]
    async fn invite_users_to_team(
        &self,
        team_id: &uuid::Uuid,
        invited_by: &MacroUserIdStr<'_>,
        invites: non_empty::NonEmpty<&[(Email<Lowercase<'_>>, TeamUserTier)]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        let invited = self
            .team_repository
            .invite_users_to_team(team_id, invited_by, invites)
            .await?;

        // Send notifications for new invites
        if !invited.is_empty() {
            let team_name = self.team_repository.get_team_name(team_id).await.ok();

            if let Some(team_name) = team_name {
                let invited_by_owned = invited_by.clone().into_owned();
                let mut sent_invite_ids = Vec::new();
                for invite in &invited {
                    if self
                        .send_invite_notification(
                            MacroUserIdStr::try_from_email(invite.email.as_ref())
                                .expect("this cannot fail"),
                            invite.team_invite_id,
                            InviteToTeamMetadata {
                                team_id: *team_id,
                                team_invite_id: invite.team_invite_id,
                                invited_by: invited_by_owned.clone(),
                                team_name: team_name.clone(),
                                role: None,
                                sender_profile_picture_url: None,
                            },
                        )
                        .await
                        .inspect_err(
                            |e| tracing::error!(error=?e, "unable to send invite notification"),
                        )
                        .is_ok()
                    {
                        sent_invite_ids.push(invite.team_invite_id);
                    }
                }
                if !sent_invite_ids.is_empty() {
                    self.team_repository
                        .mark_invites_sent(&sent_invite_ids)
                        .await
                        .inspect_err(
                            |e| tracing::error!(error=?e, "unable to mark invites as sent"),
                        )
                        .ok();
                }
            }
        }

        Ok(invited)
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_user_from_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let removed_member = self
            .team_repository
            .remove_user_from_team(team_id, user_id)
            .await?;

        self.team_channels_repository
            .remove_team_member_from_channels(team_id, user_id)
            .await?;
        let channels_removed = true;

        let subscription_id = match self.get_team_subscription(team_id).await {
            Ok(subscription_id) => subscription_id,
            Err(GetTeamSubscriptionError::Customer(e)) => {
                self.rollback_remove_user_from_team(&removed_member, channels_removed)
                    .await;
                return Err(RemoveUserFromTeamError::CustomerError(e));
            }
            Err(e) => return Err(e.into_remove_user_from_team_error()),
        };

        // Decrement the quantity of the subscription
        if let Err(e) = self
            .customer_repository
            .decrease_subscription_quantity(&subscription_id, removed_member.tier)
            .await
        {
            self.rollback_remove_user_from_team(&removed_member, channels_removed)
                .await;
            return Err(RemoveUserFromTeamError::CustomerError(e));
        }

        let roles_to_remove = vec![RoleId::TeamSubscriber, RoleId::from(removed_member.tier)];

        self.user_roles_and_permissions_service
            .dangerous_remove_roles_from_user(
                user_id,
                &non_empty::NonEmpty::new(roles_to_remove.as_slice()).unwrap(),
            )
            .await
            .map_err(RemoveUserFromTeamError::RemoveRolesFromUserError)?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
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

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team_invite(
        &self,
        team_id: &uuid::Uuid,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        self.team_repository
            .delete_team_invite(team_id, team_invite_id)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team(&self, team_id: &uuid::Uuid) -> Result<(), DeleteTeamError> {
        let members = self.team_repository.get_all_team_members(team_id).await?;

        let subscription_id = self
            .team_repository
            .get_team_subscription_id(team_id)
            .await?;
        if let Some(subscription_id) = subscription_id {
            // Cancel subscription
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

    #[tracing::instrument(skip(self), err)]
    async fn join_team(
        &self,
        team_invite_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamMember<'_>, JoinTeamError> {
        // This will fail if the user is already in another team
        let accepted_invite = self
            .team_repository
            .accept_team_invite(team_invite_id, user_id)
            .await
            .map_err(JoinTeamError::TeamError)?;

        let team_member = accepted_invite.member.clone();

        // subscribe the user to professional features from the TeamSubscriber role and the role associated with their tier
        let roles_to_add = vec![RoleId::TeamSubscriber, RoleId::from(team_member.tier)];
        let roles = non_empty::NonEmpty::new(roles_to_add.as_slice()).unwrap();

        self.user_roles_and_permissions_service
            .dangerous_upsert_roles_for_user(user_id, roles)
            .await
            .map_err(JoinTeamError::AddRolesToUserError)?;
        let roles_added = true;

        self.team_channels_repository
            .add_team_member_to_channels(&team_member.team_id, user_id)
            .await?;
        let channels_added = true;

        let subscription_id = match self.get_team_subscription(&team_member.team_id).await {
            Ok(subscription_id) => subscription_id,
            Err(GetTeamSubscriptionError::Customer(e)) => {
                self.rollback_join_team(&accepted_invite, roles_added, channels_added)
                    .await;
                return Err(JoinTeamError::CustomerError(e));
            }
            Err(e) => return Err(e.into_join_team_error()),
        };

        // Increment the quantity of the subscription by the number of emails
        if let Err(e) = self
            .customer_repository
            .increase_subscription_quantity(&subscription_id, team_member.tier)
            .await
        {
            self.rollback_join_team(&accepted_invite, roles_added, channels_added)
                .await;
            return Err(JoinTeamError::CustomerError(e));
        }

        Ok(team_member)
    }

    #[tracing::instrument(skip(self), err)]
    async fn revoke_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<(), RevokePermissionsForTeamMembersError> {
        let members = self.team_repository.get_team_members(team_id).await?;

        if members.is_empty() {
            return Ok(());
        }

        for member in members {
            let roles_to_remove = vec![RoleId::TeamSubscriber, RoleId::from(member.tier)];

            self.user_roles_and_permissions_service
                .dangerous_remove_roles_from_user(
                    &member.user_id,
                    &non_empty::NonEmpty::new(roles_to_remove.as_slice()).unwrap(),
                )
                .await
                .map_err(RevokePermissionsForTeamMembersError::RemoveRolesFromUserError)?;
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn restore_permissions_for_team_members(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<(), RestorePermissionsForTeamMembersError> {
        let members = self.team_repository.get_team_members(team_id).await?;

        if members.is_empty() {
            return Ok(());
        }

        for member in members {
            let roles = vec![RoleId::TeamSubscriber, RoleId::from(member.tier)];
            let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();

            self.user_roles_and_permissions_service
                .dangerous_upsert_roles_for_user(&member.user_id, roles)
                .await
                .map_err(RestorePermissionsForTeamMembersError::AddRolesToUserError)?;
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team(&self, team_id: &uuid::Uuid) -> Result<TeamWithMembers, TeamError> {
        self.team_repository.get_team_by_id(team_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_teams(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<Team>, TeamError> {
        self.team_repository.get_user_teams(user_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_invites(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        self.team_repository.get_user_team_invites(user_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team_invites(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        self.team_repository.get_team_invites(team_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team(
        &self,
        team_id: &uuid::Uuid,
        req: &PatchTeamRequest,
    ) -> Result<(), TeamError> {
        if let Some(user_role_updates) = req.user_role_updates.as_ref() {
            if user_role_updates.iter().any(|u| u.role == TeamRole::Owner) {
                return Err(TeamError::BadRequest(
                    "cannot assign the Owner role".to_string(),
                ));
            }

            if !user_role_updates.is_empty() {
                let team = self.team_repository.get_team_by_id(team_id).await?;

                if user_role_updates
                    .iter()
                    .any(|u| u.team_user_id.as_ref() == team.team.owner_id())
                {
                    return Err(TeamError::BadRequest(
                        "cannot downgrade the team owner's role".to_string(),
                    ));
                }

                for update in user_role_updates {
                    self.team_repository
                        .patch_team_user_role(team_id, &update.team_user_id, update.role)
                        .await?;
                }
            }
        }

        self.team_repository.patch_team(team_id, req).await
    }

    #[tracing::instrument(skip(self), err)]
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

    #[tracing::instrument(skip(self), err)]
    async fn patch_team_user_tier(
        &self,
        team_id: &uuid::Uuid,
        request: &PatchTeamUserTierRequest,
    ) -> Result<(), TeamError> {
        let team_member = self
            .team_repository
            .get_team_member(team_id, &request.team_user_id)
            .await?;

        if team_member.tier == request.new_tier {
            return Err(TeamError::BadRequest(
                "team tier cannot be the same as before".to_string(),
            ));
        }

        let team_subscription_id = self
            .get_team_subscription(team_id)
            .await
            .map_err(GetTeamSubscriptionError::into_team_error)?;

        self.team_repository
            .patch_team_tier(team_id, &request.team_user_id, request.new_tier)
            .await?;

        // ensure team member has old tier removed
        self.user_roles_and_permissions_service
            .dangerous_remove_roles_from_user(
                &request.team_user_id,
                &non_empty::NonEmpty::new(vec![RoleId::from(team_member.tier)].as_slice()).unwrap(),
            )
            .await
            .map_err(|e| TeamError::StorageLayerError(e.into()))?;

        // ensure team member has new tier added
        self.user_roles_and_permissions_service
            .dangerous_upsert_roles_for_user(
                &request.team_user_id,
                non_empty::NonEmpty::new(vec![RoleId::from(request.new_tier)].as_slice()).unwrap(),
            )
            .await
            .map_err(|e| TeamError::StorageLayerError(e.into()))?;

        // TODO: handle fallback on stripe failure
        self.customer_repository
            .update_subscription_tier(&team_subscription_id, team_member.tier, request.new_tier)
            .await
            .map_err(|e| TeamError::StorageLayerError(e.into()))?;

        Ok(())
    }
}
