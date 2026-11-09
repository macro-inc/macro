//! [`TeamSubscriptionItems`] on the team service: resolves the team's
//! subscription and serializes item changes with seat changes.

use channels::domain::ports::ChannelService;
use macro_event_broker::MacroEventBroker;
use notification::domain::service::NotificationIngress;
use roles_and_permissions::domain::port::UserRolesAndPermissionsService;

use super::TeamServiceImpl;
use crate::domain::{
    contacts_enqueuer::ContactsEnqueuer,
    crm_enqueuer::CrmEnqueuer,
    customer_repo::CustomerRepository,
    model::{ItemQuantityChange, PriceInfo, SubscriptionTerms},
    open_seat_release::OpenSeatRelease,
    owned_entity_cleanup::OwnedEntityCleanup,
    subscription_items::{TeamSubscriptionItems, TeamSubscriptionItemsError},
    team_analytics::TeamAnalytics,
    team_crm_settings_repo::TeamCrmSettingsRepository,
    team_repo::TeamRepository,
};

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
    TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    async fn team_subscription(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<stripe::SubscriptionId, TeamSubscriptionItemsError> {
        self.team_repository
            .get_team_subscription_id(team_id)
            .await?
            .ok_or(TeamSubscriptionItemsError::NoSubscription)
    }
}

impl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC> TeamSubscriptionItems
    for TeamServiceImpl<TR, CR, CS, URPS, NI, CE, TCRMS, TA, CNE, EB, OSR, OEC>
where
    TR: TeamRepository,
    CR: CustomerRepository,
    CS: ChannelService + Clone,
    URPS: UserRolesAndPermissionsService,
    NI: NotificationIngress,
    CE: CrmEnqueuer,
    TCRMS: TeamCrmSettingsRepository,
    TA: TeamAnalytics,
    CNE: ContactsEnqueuer,
    EB: MacroEventBroker + Clone,
    OSR: OpenSeatRelease,
    OEC: OwnedEntityCleanup,
{
    #[tracing::instrument(skip(self), err)]
    async fn replay_subscription_item_change(
        &self,
        idempotency_key: &str,
    ) -> Result<bool, TeamSubscriptionItemsError> {
        Ok(self
            .customer_repository
            .replay_item_change(idempotency_key)
            .await?)
    }

    #[tracing::instrument(skip(self, changes), fields(changes = changes.len()), err)]
    async fn change_team_subscription_items(
        &self,
        team_id: &uuid::Uuid,
        changes: Vec<ItemQuantityChange>,
        idempotency_key: &str,
    ) -> Result<(), TeamSubscriptionItemsError> {
        let _billing = self.customer_repository.lock_team_billing(team_id).await?;
        let subscription = self.team_subscription(team_id).await?;
        Ok(self
            .customer_repository
            .change_item_quantities(&subscription, changes, idempotency_key)
            .await?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn team_subscription_terms(
        &self,
        team_id: &uuid::Uuid,
    ) -> Result<SubscriptionTerms, TeamSubscriptionItemsError> {
        let subscription = self.team_subscription(team_id).await?;
        Ok(self
            .customer_repository
            .subscription_terms(&subscription)
            .await?)
    }

    #[tracing::instrument(skip(self), err)]
    async fn price(
        &self,
        price_id: &stripe_price_id::StripePriceId,
    ) -> Result<PriceInfo, TeamSubscriptionItemsError> {
        Ok(self.customer_repository.price(price_id).await?)
    }
}
