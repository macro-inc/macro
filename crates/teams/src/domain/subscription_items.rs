//! Non-seat items (Macro computers) on a team's subscription, keyed by price.

use crate::domain::model::{
    CustomerError, ItemQuantityChange, PriceInfo, SubscriptionTerms, TeamError,
};

/// Errors from changing or reading a team subscription's items.
#[derive(Debug, thiserror::Error)]
pub enum TeamSubscriptionItemsError {
    /// The team has no subscription to bill items on.
    #[error("the team has no subscription")]
    NoSubscription,
    /// Reading the team failed.
    #[error(transparent)]
    Team(#[from] TeamError),
    /// The billing provider refused or failed the change.
    #[error(transparent)]
    Customer(#[from] CustomerError),
}

/// Changes and reads a team subscription's items by price. Seat items keep
/// their own accounting in [`crate::domain::team_repo::TeamService`]; this
/// never interprets which price is a seat.
pub trait TeamSubscriptionItems: Clone + Send + Sync + 'static {
    /// Finish an earlier internally keyed operation using its durable receipt.
    /// Returns false only when it has not reached the billing provider yet.
    fn replay_subscription_item_change(
        &self,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<bool, TeamSubscriptionItemsError>> + Send;

    /// Apply `changes` to the team subscription in one update, serialized
    /// with the team's seat changes. See
    /// [`crate::domain::customer_repo::CustomerRepository::change_item_quantities`].
    fn change_team_subscription_items(
        &self,
        team_id: &uuid::Uuid,
        changes: Vec<ItemQuantityChange>,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<(), TeamSubscriptionItemsError>> + Send;

    /// The team subscription's period end, interval and currency.
    fn team_subscription_terms(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<SubscriptionTerms, TeamSubscriptionItemsError>> + Send;

    /// What a price charges per unit.
    fn price(
        &self,
        price_id: &stripe_price_id::StripePriceId,
    ) -> impl Future<Output = Result<PriceInfo, TeamSubscriptionItemsError>> + Send;
}
