//! Contains the service logic for teams

#[cfg(test)]
mod test;

use std::{collections::HashSet, sync::Arc};

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, MemberTeamRole, OwnerTeamRole,
};
use macro_user_id::{
    cowlike::CowLike,
    email::{Email, ReadEmailParts},
    lowercased::Lowercase,
    user_id::MacroUserIdStr,
};
use roles_and_permissions::domain::{model::RoleId, port::UserRolesAndPermissionsService};

#[cfg(feature = "ports")]
use model_entity::EntityType;
#[cfg(feature = "ports")]
use model_notifications::InviteToTeamMetadata;
#[cfg(feature = "ports")]
use notification::domain::{models::SendNotificationRequestBuilder, service::NotificationIngress};

use crate::domain::{
    contacts_enqueuer::{ContactsEnqueuer, NoOpContactsEnqueuer},
    crm_enqueuer::CrmEnqueuer,
    customer_repo::CustomerRepository,
    model::{
        CreateTeamError, CustomerError, DeleteTeamError, FREE_TEAM_MAX_MEMBERS,
        InviteUsersToTeamError, JoinTeamError, PatchTeamCrmSettingsResponse, PatchTeamRequest,
        RemoveTeamInviteError, RemoveUserFromTeamError, RestorePermissionsForTeamMembersError,
        RevokePermissionsForTeamMembersError, Team, TeamError, TeamInvite, TeamInviteDetails,
        TeamMember, TeamMembers, TeamRole, TeamWithMembers, ToggleAutoJoinDomainError,
        TryJoinTeamByDomainError, is_generic_email_domain,
    },
    team_analytics::{NoOpTeamAnalytics, TeamAnalytics, TeamAnalyticsEvent},
    team_crm_settings_repo::TeamCrmSettingsRepository,
    team_repo::{TeamChannelsRepository, TeamMembersService, TeamRepository, TeamService},
};

/// Implementation of the TeamService using a TeamRepository
#[derive(Debug)]
pub struct TeamServiceImpl<
    TR,
    CR,
    TCR,
    URPS,
    NI,
    CE,
    TCRMS,
    TA = NoOpTeamAnalytics,
    CNE = NoOpContactsEnqueuer,
> where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
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
    /// Outbound port for best-effort team lifecycle analytics events.
    team_analytics: TA,
    /// Outbound port for contact connections created through team membership.
    contacts_enqueuer: CNE,
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE> Clone
    for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
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
            team_analytics: self.team_analytics.clone(),
            contacts_enqueuer: self.contacts_enqueuer.clone(),
        }
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS>
    TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, NoOpTeamAnalytics, NoOpContactsEnqueuer>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
{
    /// Creates a new TeamService with no-op analytics.
    pub fn new(
        team_repository: TR,
        customer_repository: CR,
        team_channels_repository: TCR,
        user_roles_and_permissions_service: URPS,
        notification_ingress: Arc<NI>,
        crm_enqueuer: CE,
        team_crm_settings_repository: TCRMS,
    ) -> Self {
        Self::new_with_analytics(
            team_repository,
            customer_repository,
            team_channels_repository,
            user_roles_and_permissions_service,
            notification_ingress,
            crm_enqueuer,
            team_crm_settings_repository,
            NoOpTeamAnalytics,
        )
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA>
    TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, NoOpContactsEnqueuer>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
{
    /// Creates a new TeamService with an analytics implementation.
    #[allow(
        clippy::too_many_arguments,
        reason = "constructor mirrors TeamServiceImpl::new plus analytics port"
    )]
    pub fn new_with_analytics(
        team_repository: TR,
        customer_repository: CR,
        team_channels_repository: TCR,
        user_roles_and_permissions_service: URPS,
        notification_ingress: Arc<NI>,
        crm_enqueuer: CE,
        team_crm_settings_repository: TCRMS,
        team_analytics: TA,
    ) -> Self {
        Self {
            team_repository,
            customer_repository,
            team_channels_repository,
            user_roles_and_permissions_service,
            notification_ingress,
            crm_enqueuer,
            team_crm_settings_repository,
            team_analytics,
            contacts_enqueuer: NoOpContactsEnqueuer,
        }
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE>
    TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
{
    /// Replaces the contacts enqueuer while preserving every other service dependency.
    pub fn with_contacts_enqueuer<CNE2>(
        self,
        contacts_enqueuer: CNE2,
    ) -> TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE2>
    where
        CNE2: ContactsEnqueuer,
    {
        TeamServiceImpl {
            team_repository: self.team_repository,
            customer_repository: self.customer_repository,
            team_channels_repository: self.team_channels_repository,
            user_roles_and_permissions_service: self.user_roles_and_permissions_service,
            notification_ingress: self.notification_ingress,
            crm_enqueuer: self.crm_enqueuer,
            team_crm_settings_repository: self.team_crm_settings_repository,
            team_analytics: self.team_analytics,
            contacts_enqueuer,
        }
    }

    async fn track_team_analytics_event(&self, event: TeamAnalyticsEvent) {
        self.team_analytics
            .track_team_event(event)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    "failed to track team analytics event"
                );
            })
            .ok();
    }

    async fn enqueue_joining_user_contacts(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) {
        let Some(team_with_members) = self
            .team_repository
            .get_team_by_id(team_id)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    team_id = %team_id,
                    user_id = %user_id,
                    "failed to load team roster for contact connections"
                );
            })
            .ok()
        else {
            return;
        };

        let joining_user = user_id.clone().into_owned();
        let teammates: HashSet<_> = std::iter::once(team_with_members.team.owner_id)
            .chain(
                team_with_members
                    .members
                    .into_iter()
                    .map(|member| member.user_id),
            )
            .filter(|teammate| teammate != &joining_user)
            .collect();
        let connections = teammates
            .into_iter()
            .map(|teammate| (joining_user.clone(), teammate))
            .collect::<Vec<_>>();

        if connections.is_empty() {
            return;
        }

        self.contacts_enqueuer
            .enqueue_contact_connections(connections)
            .await
            .inspect_err(|error| {
                tracing::error!(
                    error = ?error,
                    team_id = %team_id,
                    user_id = %user_id,
                    "failed to enqueue team contact connections"
                );
            })
            .ok();
    }

    /// Backfills legacy teams that were created without a team subscription id.
    #[tracing::instrument(skip(self), err)]
    async fn backfill_legacy_team_subscription(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<(), GetTeamSubscriptionError> {
        let team_owner = self
            .team_repository
            .get_team_by_id(team_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?
            .team
            .owner_id;

        let customer_id = self
            .team_repository
            .get_stripe_customer_id(&team_owner)
            .await
            .map_err(GetTeamSubscriptionError::Team)?
            .ok_or(CustomerError::NoStripeCustomerId)
            .map_err(GetTeamSubscriptionError::Customer)?;

        let subscription_id = self
            .customer_repository
            .get_subscription_id_for_customer(&customer_id)
            .await
            .map_err(GetTeamSubscriptionError::Customer)?;

        self.customer_repository
            .convert_subscription_to_team(&subscription_id, team_id, &team_owner)
            .await
            .map_err(GetTeamSubscriptionError::Customer)?;

        self.team_repository
            .update_team_subscription(team_id, &subscription_id)
            .await
            .map_err(GetTeamSubscriptionError::Team)?;

        self.team_repository
            .update_team_payment_status(team_id, true)
            .await
            .map_err(GetTeamSubscriptionError::Team)?;

        Ok(())
    }

    /// Runs [`Self::backfill_legacy_team_subscription`], treating "the owner
    /// simply has no active subscription" as a benign outcome: the team is a
    /// free team (capped at [`FREE_TEAM_MAX_MEMBERS`]) rather than an error.
    /// Every other failure still propagates.
    async fn backfill_legacy_team_subscription_or_free(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<(), GetTeamSubscriptionError> {
        match self.backfill_legacy_team_subscription(team_id).await {
            Ok(()) => Ok(()),
            Err(GetTeamSubscriptionError::Customer(
                CustomerError::NoStripeCustomerId | CustomerError::SubscriptionNotActive,
            )) => Ok(()),
            Err(e) => Err(e),
        }
    }

    /// Best-effort rollback of a direct team add (from
    /// `try_join_team_by_domain`): removes the membership again and undoes
    /// the team seat count bump. Failures are logged and swallowed, like
    /// the other join rollbacks.
    async fn rollback_add_user_to_team(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
        failed_step: &str,
    ) {
        self.team_repository
            .remove_user_from_team(team_id, user_id)
            .await
            .inspect_err(|rollback_err| {
                tracing::error!(
                    error = ?rollback_err,
                    %team_id,
                    %user_id,
                    "unable to rollback auto-joined team member after {failed_step} failed"
                );
            })
            .ok();
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
    fn into_invite_users_to_team_error(self) -> InviteUsersToTeamError {
        match self {
            Self::Team(e) => InviteUsersToTeamError::TeamError(e),
            Self::Customer(e) => InviteUsersToTeamError::CustomerError(e),
            Self::Storage(e) => InviteUsersToTeamError::StorageLayerError(e),
        }
    }

    fn into_join_team_error(self) -> JoinTeamError {
        match self {
            Self::Team(e) => JoinTeamError::TeamError(e),
            Self::Customer(e) => JoinTeamError::CustomerError(e),
            Self::Storage(e) => JoinTeamError::StorageLayerError(e),
        }
    }
}

impl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE> TeamMembersService
    for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
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

impl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE> TeamService
    for TeamServiceImpl<TR, CR, TCR, URPS, NI, CE, TCRMS, TA, CNE>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    TCR: TeamChannelsRepository,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
{
    #[tracing::instrument(skip(self), err)]
    async fn create_team(
        &self,
        user_id: &MacroUserIdStr<'_>,
        team_name: &str,
        subscription_id: Option<&stripe::SubscriptionId>,
    ) -> Result<Team, CreateTeamError> {
        // New teams start with `team_crm_settings.crm_enabled = false`
        // (seeded by `team_repository.create_team`), so there's nothing
        // for the email-backfill fan-out to populate yet. The fan-out
        // happens later, on the disabled → enabled transition in
        // `set_team_crm_enabled`.
        let team = self
            .team_repository
            .create_team(user_id, team_name, subscription_id)
            .await?;
        if let Some(subscription_id) = subscription_id {
            self.customer_repository
                .convert_subscription_to_team(subscription_id, team.id(), user_id)
                .await
                .map_err(|e| CreateTeamError::StorageLayerError(e.into()))?;
        }
        self.team_repository
            .move_github_app_installation_to_team_if_exists(user_id, team.id())
            .await?;

        // Auto-join is on by default for corporate domains: colleagues who
        // sign up with the same domain are added to the team automatically.
        // Owners can turn it off in settings. Best-effort — creation
        // succeeds even if this fails.
        let owner_email = user_id.email_part().lowercase();
        if !is_generic_email_domain(owner_email.domain_part()) {
            self.team_repository
                .toggle_auto_join_domain(team.id())
                .await
                .inspect_err(|e| tracing::error!(error=?e, "unable to default auto-join domain on"))
                .ok();
        }

        self.track_team_analytics_event(TeamAnalyticsEvent::TeamCreated {
            team_id: *team.id(),
            owner_id: user_id.clone().into_owned(),
            team_name: team.name().to_owned(),
        })
        .await;

        Ok(team)
    }

    #[tracing::instrument(skip(self), err)]
    async fn is_user_premium(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<stripe::SubscriptionId>, TeamError> {
        let Some(customer_id) = self.team_repository.get_stripe_customer_id(user_id).await? else {
            return Ok(None);
        };

        match self
            .customer_repository
            .get_subscription_id_for_customer(&customer_id)
            .await
        {
            Ok(subscription_id) => Ok(Some(subscription_id)),
            Err(CustomerError::NoStripeCustomerId | CustomerError::SubscriptionNotActive) => {
                Ok(None)
            }
            Err(e) => Err(TeamError::StorageLayerError(e.into())),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn invite_users_to_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<MemberTeamRole>,
        invites: non_empty::NonEmpty<&[Email<Lowercase<'_>>]>,
    ) -> Result<Vec<TeamInvite<'_>>, InviteUsersToTeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        let enterprise = self
            .team_repository
            .get_team_enterprise_status(&team_id)
            .await?;

        if !enterprise
            && !self
                .team_repository
                .get_team_payment_status(&team_id)
                .await?
        {
            // If the team has a subscription id and they are set to not paying continue to error
            if self
                .team_repository
                .get_team_subscription_id(&team_id)
                .await?
                .is_some()
            {
                return Err(InviteUsersToTeamError::TeamError(TeamError::TeamNotPaying));
            }

            self.backfill_legacy_team_subscription_or_free(&team_id)
                .await
                .map_err(GetTeamSubscriptionError::into_invite_users_to_team_error)?;
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

        // Free teams (no subscription) are capped at FREE_TEAM_MAX_MEMBERS.
        if !enterprise
            && team_plan.is_none()
            && self
                .team_repository
                .get_team_subscription_id(&team_id)
                .await?
                .is_none()
            && seat_count + new_invites.len() as i32 > FREE_TEAM_MAX_MEMBERS
        {
            return Err(InviteUsersToTeamError::NotEnoughOpenSeats);
        }

        let new_invite_emails: HashSet<String> = new_invites
            .iter()
            .map(|email| email.as_ref().to_owned())
            .collect();

        let invited = self
            .team_repository
            .invite_users_to_team(&team_id, invited_by, invites)
            .await?;

        let team_name = if invited.is_empty() {
            None
        } else {
            self.team_repository.get_team_name(&team_id).await.ok()
        };

        // Send notifications for new invites
        if !invited.is_empty()
            && let Some(team_name) = team_name.clone()
        {
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
                    .inspect_err(|e| tracing::error!(error=?e, "unable to mark invites as sent"))
                    .ok();
            }
        }

        for invite in &invited {
            if !new_invite_emails.contains(invite.email.as_ref()) {
                continue;
            }

            self.track_team_analytics_event(TeamAnalyticsEvent::TeamInvited {
                team_id,
                team_invite_id: invite.team_invite_id,
                inviter_id: invited_by.clone().into_owned(),
                team_name: team_name.clone(),
            })
            .await;
        }

        Ok(invited)
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_user_from_team(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), RemoveUserFromTeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();
        let removed_by_id = entity_access_receipt
            .get_authenticated_user()
            .map_err(|e| RemoveUserFromTeamError::TeamError(TeamError::AccessError(e)))?
            .clone()
            .into_owned();

        let enterprise = self
            .team_repository
            .get_team_enterprise_status(&team_id)
            .await?;

        let removed_member = self
            .team_repository
            .remove_user_from_team(&team_id, user_id)
            .await?;

        let subscription_id = if enterprise {
            None
        } else {
            // Free teams have no linked subscription — nothing to decrement.
            match self
                .team_repository
                .get_team_subscription_id(&team_id)
                .await
            {
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
                    return Err(RemoveUserFromTeamError::TeamError(e));
                }
            }
        };

        if let Some(subscription_id) = subscription_id.as_ref()
            && let Err(e) = self
                .customer_repository
                .decrement_seat_count(subscription_id, 1)
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
            if let Some(subscription_id) = subscription_id.as_ref() {
                self.customer_repository
                    .increment_seat_count(subscription_id, 1)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback customer seat count after removing team member from channels failed"
                        );
                    })
                    .ok();
            }
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
            if let Some(subscription_id) = subscription_id.as_ref() {
                self.customer_repository
                    .increment_seat_count(subscription_id, 1)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback customer seat count after removing team member roles failed"
                        );
                    })
                    .ok();
            }
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

        self.track_team_analytics_event(TeamAnalyticsEvent::TeamLeft {
            team_id,
            member_id: removed_member.user_id.clone().into_owned(),
            removed_by_id,
            role: removed_member.role,
        })
        .await;

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
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
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
        let enterprise = match self
            .team_repository
            .get_team_enterprise_status(&team_member.team_id)
            .await
        {
            Ok(enterprise) => enterprise,
            Err(error) => {
                self.team_repository
                    .rollback_accept_team_invite(&accepted_invite)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback accepted team invite after getting enterprise status failed"
                        );
                    })
                    .ok();
                return Err(JoinTeamError::TeamError(error));
            }
        };

        let subscription_id = if enterprise {
            None
        } else {
            let team_payment_status = match self
                .team_repository
                .get_team_payment_status(&team_member.team_id)
                .await
            {
                Ok(team_payment_status) => team_payment_status,
                Err(error) => {
                    self.team_repository
                        .rollback_accept_team_invite(&accepted_invite)
                        .await
                        .inspect_err(|rollback_err| {
                            tracing::error!(
                                error=?rollback_err,
                                "unable to rollback accepted team invite after getting team payment status failed"
                            );
                        })
                        .ok();
                    return Err(JoinTeamError::TeamError(error));
                }
            };

            if !team_payment_status {
                // If the team has a subscription id and they are set to not paying continue to error
                let team_subscription_id = match self
                    .team_repository
                    .get_team_subscription_id(&accepted_invite.member.team_id)
                    .await
                {
                    Ok(team_subscription_id) => team_subscription_id,
                    Err(error) => {
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
                        return Err(JoinTeamError::TeamError(error));
                    }
                };

                if team_subscription_id.is_some() {
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

                if let Err(e) = self
                    .backfill_legacy_team_subscription_or_free(&accepted_invite.member.team_id)
                    .await
                {
                    self.team_repository
                        .rollback_accept_team_invite(&accepted_invite)
                        .await
                        .inspect_err(|rollback_err| {
                            tracing::error!(
                                error=?rollback_err,
                                "unable to rollback accepted team invite after backfilling team subscription failed"
                            );
                        })
                        .ok();
                    return Err(e.into_join_team_error());
                }
            }

            let team_subscription_id = match self
                .team_repository
                .get_team_subscription_id(&team_member.team_id)
                .await
            {
                Ok(team_subscription_id) => team_subscription_id,
                Err(error) => {
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
                    return Err(JoinTeamError::TeamError(error));
                }
            };

            match team_subscription_id {
                // Free team: no seat billing, but the member count (which
                // already includes this newly accepted member) must stay
                // within the free limit.
                None => {
                    let seat_count = match self
                        .team_repository
                        .get_team_seat_count(&team_member.team_id)
                        .await
                    {
                        Ok(seat_count) => seat_count,
                        Err(error) => {
                            self.team_repository
                                .rollback_accept_team_invite(&accepted_invite)
                                .await
                                .inspect_err(|rollback_err| {
                                    tracing::error!(
                                        error=?rollback_err,
                                        "unable to rollback accepted team invite after getting team seat count failed"
                                    );
                                })
                                .ok();
                            return Err(JoinTeamError::TeamError(error));
                        }
                    };

                    if seat_count > FREE_TEAM_MAX_MEMBERS {
                        self.team_repository
                            .rollback_accept_team_invite(&accepted_invite)
                            .await
                            .inspect_err(|rollback_err| {
                                tracing::error!(
                                    error=?rollback_err,
                                    "unable to rollback accepted team invite after the free member limit check"
                                );
                            })
                            .ok();
                        return Err(JoinTeamError::FreeTeamLimitReached);
                    }

                    None
                }
                Some(subscription_id) => {
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

                    Some(subscription_id)
                }
            }
        };

        // Premium roles come with a paid or enterprise team; free-team
        // members keep their existing (free) entitlements.
        let grants_premium = enterprise || subscription_id.is_some();
        let roles_to_add = vec![RoleId::TeamSubscriber, RoleId::SubOpus];

        if grants_premium {
            // subscribe the user to professional features from the TeamSubscriber role and the role associated with their tier
            let roles = non_empty::NonEmpty::new(roles_to_add.as_slice()).unwrap();

            if let Err(e) = self
                .user_roles_and_permissions_service
                .dangerous_upsert_roles_for_user(user_id, roles)
                .await
            {
                if let Some(subscription_id) = subscription_id.as_ref() {
                    self.customer_repository
                        .decrement_seat_count(subscription_id, 1)
                        .await
                        .inspect_err(|rollback_err| {
                            tracing::error!(
                                error=?rollback_err,
                                "unable to rollback customer seat count after adding team member roles failed"
                            );
                        })
                        .ok();
                }
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
        }

        if let Err(e) = self
            .team_channels_repository
            .add_team_member_to_channels(&team_member.team_id, user_id)
            .await
        {
            if grants_premium {
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
            }
            if let Some(subscription_id) = subscription_id.as_ref() {
                self.customer_repository
                    .decrement_seat_count(subscription_id, 1)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback customer seat count after adding team member to channels failed"
                        );
                    })
                    .ok();
            }
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

        self.enqueue_joining_user_contacts(&team_member.team_id, user_id)
            .await;

        self.track_team_analytics_event(TeamAnalyticsEvent::TeamJoined {
            team_id: team_member.team_id,
            team_invite_id: accepted_invite.invite.id,
            member_id: team_member.user_id.clone().into_owned(),
            role: team_member.role,
        })
        .await;

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
        backfill: bool,
    ) -> Result<PatchTeamCrmSettingsResponse, TeamError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        if enabled {
            // Fetch the members *before* flipping the flag so a member-list
            // failure leaves the flag untouched — a retry will then re-run
            // the full backfill instead of hitting the early-return below.
            let members = if backfill {
                self.team_repository.get_team_members(&team_id).await?
            } else {
                Vec::new()
            };

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

    #[tracing::instrument(skip(self), err)]
    async fn toggle_auto_join_domain(
        &self,
        entity_access_receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<Option<String>, ToggleAutoJoinDomainError> {
        let team_id =
            macro_uuid::string_to_uuid(&entity_access_receipt.entity().entity_id).unwrap();

        self.team_repository.toggle_auto_join_domain(&team_id).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn try_join_team_by_domain(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<Option<TeamMember<'static>>, TryJoinTeamByDomainError> {
        let Some(team_id) = self.team_repository.get_team_id_by_domain(user_id).await? else {
            return Ok(None);
        };

        let enterprise = self
            .team_repository
            .get_team_enterprise_status(&team_id)
            .await?;

        // Mirror the seat-cap check from invite_users_to_team — an
        // auto-join must not push the team past its plan's seat cap.
        if let Some(team_plan) = self.team_repository.get_team_plan(&team_id).await? {
            let seat_count = self.team_repository.get_team_seat_count(&team_id).await?;
            if seat_count + 1 > team_plan.seat_cap() {
                tracing::info!(%team_id, %user_id, "skipping team auto-join: team is at its seat cap");
                return Ok(None);
            }
        }

        // Add the user to the team directly (no invite), then run the same
        // billing / roles / channels side effects as join_team, rolling
        // the membership back if any of them fail.
        let Some(team_member) = self
            .team_repository
            .add_user_to_team(&team_id, user_id)
            .await?
        else {
            tracing::info!(%team_id, %user_id, "skipping team auto-join: user is already a member");
            return Ok(None);
        };

        let subscription_id = if enterprise {
            None
        } else {
            let team_payment_status =
                match self.team_repository.get_team_payment_status(&team_id).await {
                    Ok(team_payment_status) => team_payment_status,
                    Err(error) => {
                        self.rollback_add_user_to_team(
                            &team_id,
                            user_id,
                            "getting team payment status",
                        )
                        .await;
                        return Err(error.into());
                    }
                };

            if !team_payment_status {
                // If the team has a subscription id and they are set to not paying continue to error
                let team_subscription_id = match self
                    .team_repository
                    .get_team_subscription_id(&team_id)
                    .await
                {
                    Ok(team_subscription_id) => team_subscription_id,
                    Err(error) => {
                        self.rollback_add_user_to_team(
                            &team_id,
                            user_id,
                            "getting team subscription id",
                        )
                        .await;
                        return Err(error.into());
                    }
                };

                if team_subscription_id.is_some() {
                    self.rollback_add_user_to_team(&team_id, user_id, "the payment status check")
                        .await;
                    return Err(JoinTeamError::TeamError(TeamError::TeamNotPaying).into());
                }

                if let Err(e) = self
                    .backfill_legacy_team_subscription_or_free(&team_id)
                    .await
                {
                    self.rollback_add_user_to_team(
                        &team_id,
                        user_id,
                        "backfilling team subscription",
                    )
                    .await;
                    return Err(e.into_join_team_error().into());
                }
            }

            let team_subscription_id = match self
                .team_repository
                .get_team_subscription_id(&team_id)
                .await
            {
                Ok(team_subscription_id) => team_subscription_id,
                Err(error) => {
                    self.rollback_add_user_to_team(&team_id, user_id, "getting team subscription")
                        .await;
                    return Err(error.into());
                }
            };

            match team_subscription_id {
                // Free team: no seat billing. The member count (already
                // bumped by add_user_to_team) must stay within the free
                // limit — over the cap, skip the auto-join silently like
                // the plan seat-cap check above.
                None => {
                    let seat_count = match self.team_repository.get_team_seat_count(&team_id).await
                    {
                        Ok(seat_count) => seat_count,
                        Err(error) => {
                            self.rollback_add_user_to_team(
                                &team_id,
                                user_id,
                                "getting team seat count",
                            )
                            .await;
                            return Err(error.into());
                        }
                    };

                    if seat_count > FREE_TEAM_MAX_MEMBERS {
                        tracing::info!(%team_id, %user_id, "skipping team auto-join: free team is at its member limit");
                        self.rollback_add_user_to_team(
                            &team_id,
                            user_id,
                            "the free member limit check",
                        )
                        .await;
                        return Ok(None);
                    }

                    None
                }
                Some(subscription_id) => {
                    if let Err(e) = self
                        .customer_repository
                        .increment_seat_count(&subscription_id, 1)
                        .await
                    {
                        self.rollback_add_user_to_team(
                            &team_id,
                            user_id,
                            "incrementing seat count",
                        )
                        .await;
                        return Err(JoinTeamError::CustomerError(e).into());
                    }

                    Some(subscription_id)
                }
            }
        };

        // Premium roles come with a paid or enterprise team; free-team
        // members keep their existing (free) entitlements.
        let grants_premium = enterprise || subscription_id.is_some();
        let roles_to_add = vec![RoleId::TeamSubscriber, RoleId::SubOpus];

        if grants_premium {
            // subscribe the user to professional features from the TeamSubscriber role and the role associated with their tier
            let roles = non_empty::NonEmpty::new(roles_to_add.as_slice()).unwrap();

            if let Err(e) = self
                .user_roles_and_permissions_service
                .dangerous_upsert_roles_for_user(user_id, roles)
                .await
            {
                if let Some(subscription_id) = subscription_id.as_ref() {
                    self.customer_repository
                        .decrement_seat_count(subscription_id, 1)
                        .await
                        .inspect_err(|rollback_err| {
                            tracing::error!(
                                error=?rollback_err,
                                "unable to rollback customer seat count after adding team member roles failed"
                            );
                        })
                        .ok();
                }
                self.rollback_add_user_to_team(&team_id, user_id, "adding team member roles")
                    .await;
                return Err(JoinTeamError::AddRolesToUserError(e).into());
            }
        }

        if let Err(e) = self
            .team_channels_repository
            .add_team_member_to_channels(&team_id, user_id)
            .await
        {
            if grants_premium {
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
            }
            if let Some(subscription_id) = subscription_id.as_ref() {
                self.customer_repository
                    .decrement_seat_count(subscription_id, 1)
                    .await
                    .inspect_err(|rollback_err| {
                        tracing::error!(
                            error=?rollback_err,
                            "unable to rollback customer seat count after adding team member to channels failed"
                        );
                    })
                    .ok();
            }
            self.rollback_add_user_to_team(&team_id, user_id, "adding team member to channels")
                .await;
            return Err(JoinTeamError::TeamError(e).into());
        }

        // Best-effort: ask the email service to seed CRM tables from this
        // user's historical sent mail, same as join_team.
        if let Err(e) = self
            .crm_enqueuer
            .enqueue_populate_crm_for_user(user_id)
            .await
        {
            tracing::error!(
                error = ?e,
                team_id = %team_id,
                macro_id = %user_id,
                "Failed to enqueue PopulateCrmForUser after team auto-join; CRM tables will not be seeded from sent-mail history (per-message fan-out will still cover future sends)"
            );
        }

        self.enqueue_joining_user_contacts(&team_id, user_id).await;

        // NOTE: no TeamJoined analytics event here — that event is tied to
        // the team invite that was accepted, and a domain auto-join has none.

        Ok(Some(team_member))
    }
}
