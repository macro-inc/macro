//! Contains the service logic for teams

#[cfg(test)]
mod test;

use std::{collections::HashSet, sync::Arc};

use anyhow::Context;
use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, MemberTeamRole, OwnerTeamRole,
};
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
    crm_enqueuer::CrmEnqueuer,
    customer_repo::CustomerRepository,
    model::{
        CreateTeamError, CustomerError, DeleteTeamError, InviteUsersToTeamError, JoinTeamError,
        PatchTeamCrmSettingsResponse, PatchTeamRequest, RemoveTeamInviteError,
        RemoveUserFromTeamError, RestorePermissionsForTeamMembersError,
        RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamInviteDetails,
        TeamMember, TeamMembers, TeamRole, TeamWithMembers,
    },
    team_crm_settings_repo::TeamCrmSettingsRepository,
    team_repo::{TeamChannelsRepository, TeamMembersService, TeamRepository, TeamService},
};

/// Implementation of the TeamService using a TeamRepository
#[derive(Debug)]
pub struct TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
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
    /// Outbound enqueuer for the populate / depopulate CRM backfills
    /// fired from `create_team` / `join_team` / `remove_user_from_team`.
    /// See [`CrmEnqueuer`].
    crm_enqueuer: CE,
    /// Repository for the `team_crm_settings` row and the bulk CRM
    /// teardown invoked from `set_team_crm_enabled`.
    team_crm_settings_repository: TCRMS,
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS> Clone for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
{
    fn clone(&self) -> Self {
        Self {
            team_repository: self.team_repository.clone(),
            customer_repository: self.customer_repository.clone(),
            team_channels_repository: self.team_channels_repository.clone(),
            user_roles_and_permissions_service: self.user_roles_and_permissions_service.clone(),
            notification_ingress: self.notification_ingress.clone(),
            crm_enqueuer: self.crm_enqueuer.clone(),
            team_crm_settings_repository: self.team_crm_settings_repository.clone(),
        }
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS> TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
{
    /// Creates a new TeamService
    pub fn new(
        team_repository: TR,
        customer_repository: CR,
        team_channels_repository: TCR,
        user_roles_and_permissions_service: URPS,
        notification_ingress: Arc<NI>,
        crm_enqueuer: CE,
        team_crm_settings_repository: TCRMS,
    ) -> Self {
        Self {
            team_repository,
            customer_repository,
            team_channels_repository,
            user_roles_and_permissions_service,
            notification_ingress,
            crm_enqueuer,
            team_crm_settings_repository,
        }
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS> TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
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
            secondary_notification_entity: None,
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
}

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
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS> TeamMembersService
    for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn list_team_members(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<TeamMembers, TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        let members = self.team_repository.get_team_by_id(&team_id).await?.members;
        let invited = self.team_repository.get_team_invites(&team_id).await?;

        Ok(TeamMembers { members, invited })
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS> TeamService
    for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
    ) -> Result<Team, CreateTeamError> {
        // New teams start with `team_crm_settings.crm_enabled = false`
        // (seeded by `team_repository.create_team`), so there's nothing
        // for the email-backfill fan-out to populate yet. The fan-out
        // happens later, on the disabled → enabled transition in
        // `set_team_crm_enabled`.
        let team = self.team_repository.create_team(user_id, team_name).await?;
        self.team_repository
            .move_github_app_installation_to_team_if_exists(user_id, team.id())
            .await?;
        Ok(team)
    }

    #[tracing::instrument(skip(self), err)]
    async fn is_user_premium(&self, user_id: &MacroUserIdStr<'_>) -> Result<bool, TeamError> {
        let Some(customer_id) = self.team_repository.get_stripe_customer_id(user_id).await? else {
            return Ok(false);
        };

        match self
            .customer_repository
            .get_subscription_id_for_customer(&customer_id)
            .await
        {
            Ok(_) => Ok(true),
            Err(CustomerError::NoStripeCustomerId | CustomerError::SubscriptionNotActive) => {
                Ok(false)
            }
            Err(e) => Err(TeamError::StorageLayerError(e.into())),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn invite_users_to_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        if !self
            .team_repository
            .get_team_payment_status(&team_id)
            .await?
        {
            return Err(InviteUsersToTeamError::TeamError(TeamError::TeamNotPaying));
        }

        let invited_by = entity_access_receipt
            .get_authenticated_user()
            .map_err(|e| InviteUsersToTeamError::TeamError(TeamError::AccessError(e)))?;

        let team_plan = self.team_repository.get_team_plan(&team_id).await?;
        let seat_count = self.team_repository.get_team_seat_count(&team_id).await?;

        let new_invites = self
            .team_repository
            .get_new_invites(&team_id, invites.clone())
            .await?;

        if let Some(team_plan) = team_plan
            && seat_count + new_invites.len() as i32 > team_plan.seat_cap()
        {
            return Err(InviteUsersToTeamError::NotEnoughOpenSeats);
        }

        let invited = self
            .team_repository
            .invite_users_to_team(&team_id, invited_by, invites)
            .await?;

        // Send notifications for new invites
        if !invited.is_empty() {
            let team_name = self.team_repository.get_team_name(&team_id).await.ok();

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
                                team_id,
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
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        let removed_member = self
            .team_repository
            .remove_user_from_team(&team_id, user_id)
            .await?;

        let subscription_id = match self.get_team_subscription(&team_id).await {
            Ok(subscription_id) => subscription_id,
            Err(e) => {
                self.team_repository
                    .rollback_remove_user_from_team(&removed_member)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback removed team member after getting team subscription failed"
                        );
                    })
                    .ok();
                return Err(e.into_remove_user_from_team_error());
            }
        };

        if let Err(e) = self
            .customer_repository
            .decrement_seat_count(&subscription_id, 1)
            .await
        {
            self.team_repository
                .rollback_remove_user_from_team(&removed_member)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback removed team member after decrementing seat count failed"
                    );
                })
                .ok();
            return Err(RemoveUserFromTeamError::CustomerError(e));
        }

        if let Err(e) = self
            .team_channels_repository
            .remove_team_member_from_channels(&team_id, user_id)
            .await
        {
            self.customer_repository
                .increment_seat_count(&subscription_id, 1)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback customer seat count after removing team member from channels failed"
                    );
                })
                .ok();
            self.team_repository
                .rollback_remove_user_from_team(&removed_member)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback removed team member after removing team member from channels failed"
                    );
                })
                .ok();
            return Err(RemoveUserFromTeamError::TeamError(e));
        }

        let roles_to_remove = vec![RoleId::TeamSubscriber, RoleId::SubOpus];
        let roles = non_empty::NonEmpty::new(roles_to_remove.as_slice()).unwrap();

        if let Err(e) = self
            .user_roles_and_permissions_service
            .dangerous_remove_roles_from_user(user_id, &roles)
            .await
        {
            self.team_channels_repository
                .add_team_member_to_channels(&team_id, user_id)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback team channel membership after removing team member roles failed"
                    );
                })
                .ok();
            self.customer_repository
                .increment_seat_count(&subscription_id, 1)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback customer seat count after removing team member roles failed"
                    );
                })
                .ok();
            self.team_repository
                .rollback_remove_user_from_team(&removed_member)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback removed team member after removing team member roles failed"
                    );
                })
                .ok();
            return Err(RemoveUserFromTeamError::RemoveRolesFromUserError(e));
        }

        // Best-effort: ask the email service to tear down CRM rows
        // sourced from this user's email link. Log and swallow failures
        // — the removal is already committed and the email-service
        // handler is idempotent, so a missed enqueue can be retried
        // without leaving the system in an inconsistent state. Team
        // deletion is handled separately via the
        // `crm_companies.team_id` FK cascade and does NOT route through
        // this enqueuer.
        if let Err(e) = self
            .crm_enqueuer
            .enqueue_depopulate_crm_for_user(&team_id, user_id)
            .await
        {
            tracing::error!(
                error = ?e,
                team_id = %team_id,
                macro_id = %user_id,
                "Failed to enqueue DepopulateCrmForUser after remove_user_from_team; CRM rows owned by the removed user's link will be left in place until manual cleanup"
            );
        }

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
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
        team_invite_id: &uuid::Uuid,
    ) -> Result<(), RemoveTeamInviteError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        self.team_repository
            .delete_team_invite(&team_id, team_invite_id)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<OwnerTeamRole>,
    ) -> Result<(), DeleteTeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        let members = self.team_repository.get_all_team_members(&team_id).await?;

        let subscription_id = self
            .team_repository
            .get_team_subscription_id(&team_id)
            .await?;
        if let Some(subscription_id) = subscription_id {
            // Cancel subscription
            self.customer_repository
                .cancel_subscription(&subscription_id)
                .await
                .map_err(DeleteTeamError::CustomerError)?;
        }

        self.team_repository
            .delete_team(&team_id)
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

        if !self
            .team_repository
            .get_team_payment_status(&team_member.team_id)
            .await?
        {
            self.team_repository
                    .rollback_accept_team_invite(&accepted_invite)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback accepted team invite after getting team subscription failed"
                        );
                    })
                    .ok();
            return Err(JoinTeamError::TeamError(TeamError::TeamNotPaying));
        }

        let subscription_id = match self.get_team_subscription(&team_member.team_id).await {
            Ok(subscription_id) => subscription_id,
            Err(e) => {
                self.team_repository
                    .rollback_accept_team_invite(&accepted_invite)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback accepted team invite after getting team subscription failed"
                        );
                    })
                    .ok();
                return Err(e.into_join_team_error());
            }
        };

        if let Err(e) = self
            .customer_repository
            .increment_seat_count(&subscription_id, 1)
            .await
        {
            self.team_repository
                .rollback_accept_team_invite(&accepted_invite)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback accepted team invite after incrementing seat count failed"
                    );
                })
                .ok();
            return Err(JoinTeamError::CustomerError(e));
        }

        // subscribe the user to professional features from the TeamSubscriber role and the role associated with their tier
        let roles_to_add = vec![RoleId::TeamSubscriber, RoleId::SubOpus];
        let roles = non_empty::NonEmpty::new(roles_to_add.as_slice()).unwrap();

        if let Err(e) = self
            .user_roles_and_permissions_service
            .dangerous_upsert_roles_for_user(user_id, roles)
            .await
        {
            self.customer_repository
                .decrement_seat_count(&subscription_id, 1)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback customer seat count after adding team member roles failed"
                    );
                })
                .ok();
            self.team_repository
                .rollback_accept_team_invite(&accepted_invite)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback accepted team invite after adding team member roles failed"
                    );
                })
                .ok();
            return Err(JoinTeamError::AddRolesToUserError(e));
        }

        if let Err(e) = self
            .team_channels_repository
            .add_team_member_to_channels(&team_member.team_id, user_id)
            .await
        {
            let roles = non_empty::NonEmpty::new(roles_to_add.as_slice()).unwrap();
            self.user_roles_and_permissions_service
                .dangerous_remove_roles_from_user(user_id, &roles)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback team member roles after adding team member to channels failed"
                    );
                })
                .ok();
            self.customer_repository
                .decrement_seat_count(&subscription_id, 1)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback customer seat count after adding team member to channels failed"
                    );
                })
                .ok();
            self.team_repository
                .rollback_accept_team_invite(&accepted_invite)
                .await
                .inspect_err(|rollback_err| {
                    tracing::error!(
                        error=?rollback_err,
                        "unable to rollback accepted team invite after adding team member to channels failed"
                    );
                })
                .ok();
            return Err(JoinTeamError::TeamError(e));
        }

        // Best-effort: ask the email service to seed CRM tables from this
        // user's historical sent mail. Log and swallow failures — the join
        // is already committed and the email-service consumer is idempotent,
        // so a missed enqueue can be retried (or covered by per-message CRM
        // fan-out) without leaving the system in an inconsistent state.
        if let Err(e) = self
            .crm_enqueuer
            .enqueue_populate_crm_for_user(user_id)
            .await
        {
            tracing::error!(
                error = ?e,
                team_id = %team_member.team_id,
                macro_id = %user_id,
                "Failed to enqueue PopulateCrmForUser after join_team; CRM tables will not be seeded from sent-mail history (per-message fan-out will still cover future sends)"
            );
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
            let roles_to_remove = vec![RoleId::TeamSubscriber, RoleId::SubOpus];

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
            let roles = vec![RoleId::TeamSubscriber, RoleId::SubOpus];
            let roles = non_empty::NonEmpty::new(roles.as_slice()).unwrap();

            self.user_roles_and_permissions_service
                .dangerous_upsert_roles_for_user(&member.user_id, roles)
                .await
                .map_err(RestorePermissionsForTeamMembersError::AddRolesToUserError)?;
        }

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team_subscription_id(
        &self,
        team_id: &uuid::Uuid,
        subscription_id: &stripe::SubscriptionId,
    ) -> Result<(), TeamError> {
        self.team_repository
            .update_team_subscription(team_id, subscription_id)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team_payment_status(
        &self,
        team_id: &uuid::Uuid,
        paying: bool,
    ) -> Result<(), TeamError> {
        self.team_repository
            .update_team_payment_status(team_id, paying)
            .await?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<TeamWithMembers, TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();
        self.team_repository.get_team_by_id(&team_id).await
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
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Vec<TeamInviteDetails>, TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();
        self.team_repository.get_team_invites(&team_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn patch_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        req: &PatchTeamRequest,
    ) -> Result<(), TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        if let Some(user_role_updates) = req.user_role_updates.as_ref() {
            if user_role_updates.iter().any(|u| u.role == TeamRole::Owner) {
                return Err(TeamError::BadRequest(
                    "cannot assign the Owner role".to_string(),
                ));
            }

            if !user_role_updates.is_empty() {
                let team = self.team_repository.get_team_by_id(&team_id).await?;

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
                        .patch_team_user_role(&team_id, &update.team_user_id, update.role)
                        .await?;
                }
            }
        }

        self.team_repository.patch_team(&team_id, req).await
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
    async fn set_team_crm_enabled(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        enabled: bool,
    ) -> Result<PatchTeamCrmSettingsResponse, TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        if enabled {
            // Fetch the members *before* flipping the flag so a member-list
            // failure leaves the flag untouched — a retry will then re-run
            // the full backfill instead of hitting the early-return below.
            let members = self.team_repository.get_team_members(&team_id).await?;

            let changed = self
                .team_crm_settings_repository
                .enable_crm(&team_id)
                .await?;

            if !changed {
                return Ok(PatchTeamCrmSettingsResponse {
                    enabled: true,
                    changed: false,
                    backfill_enqueued: 0,
                    backfill_failed: 0,
                });
            }

            let mut enqueued = 0usize;
            let mut failed = 0usize;

            for member in members {
                match self
                    .crm_enqueuer
                    .enqueue_populate_crm_for_user(&member.user_id)
                    .await
                {
                    Ok(()) => enqueued += 1,
                    Err(e) => {
                        failed += 1;
                        tracing::error!(
                            error = ?e,
                            team_id = %team_id,
                            macro_id = %member.user_id,
                            "Failed to enqueue PopulateCrmForUser during team CRM enable"
                        );
                    }
                }
            }

            Ok(PatchTeamCrmSettingsResponse {
                enabled: true,
                changed: true,
                backfill_enqueued: enqueued,
                backfill_failed: failed,
            })
        } else {
            let was_enabled = self
                .team_crm_settings_repository
                .get_crm_enabled(&team_id)
                .await?;

            // Run the disable+purge unconditionally so a stale row left
            // over from a prior failed disable still gets cleaned up.
            self.team_crm_settings_repository
                .disable_crm_and_purge_data(&team_id)
                .await?;

            Ok(PatchTeamCrmSettingsResponse {
                enabled: false,
                changed: was_enabled,
                backfill_enqueued: 0,
                backfill_failed: 0,
            })
        }
    }
}
