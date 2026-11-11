//! Macro computers billed on the team subscription through `teams`, and the
//! webhook observer that reports subscription snapshots to `hosted_runtimes`.

use chrono::{DateTime, Utc};
use hosted_runtimes::domain::{
    ids::ComputerId,
    lifecycle::SubscriptionItemId,
    models::{BillingInterval, Quote, SubscriptionItem},
    ports::{Billing, BillingError, ComputerRepo, ItemCharge},
    service::{Clock, ComputerService, SubscriptionObserved},
    size::ComputerSize,
};
use teams::domain::{
    model::{BillingCadence, CustomerError, ItemProration, ItemQuantityChange, ItemRemoval},
    subscription_items::{TeamSubscriptionItems, TeamSubscriptionItemsError},
};
use uuid::Uuid;

use crate::domain::computer_billing::{ComputerBillingObserver, ComputerPrices};

#[cfg(test)]
mod test;

/// [`Billing`] on the team subscription: one item per computer, at a price
/// of its own copied from the size's price at the subscription's interval.
#[derive(Clone)]
pub struct TeamComputerBilling<Teams> {
    teams: Teams,
    prices: ComputerPrices,
}

impl<Teams: TeamSubscriptionItems> TeamComputerBilling<Teams> {
    pub fn new(teams: Teams, prices: ComputerPrices) -> Self {
        Self { teams, prices }
    }

    async fn interval(&self, team_id: Uuid) -> Result<BillingInterval, BillingError> {
        let terms = self
            .teams
            .team_subscription_terms(&team_id)
            .await
            .map_err(billing_error)?;
        match terms.interval {
            BillingCadence::Month => Ok(BillingInterval::Month),
            BillingCadence::Year => Ok(BillingInterval::Year),
            cadence @ (BillingCadence::Day | BillingCadence::Week) => Err(BillingError::Provider(
                rootcause::report!("team subscription bills every {cadence:?}"),
            )),
        }
    }

    async fn computer_price(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<(stripe::PriceId, BillingInterval), BillingError> {
        if self.prices.is_empty() {
            return Err(BillingError::NotAvailable);
        }
        let interval = self.interval(team_id).await?;
        let price_id = self
            .prices
            .price_id(size, interval)
            .ok_or(BillingError::IntervalNotSold(interval))?;
        Ok((price_id.clone(), interval))
    }
}

impl<Teams: TeamSubscriptionItems> Billing for TeamComputerBilling<Teams> {
    fn sales_available(&self) -> bool {
        !self.prices.is_empty()
    }

    #[tracing::instrument(skip(self), err)]
    async fn quote(&self, team_id: Uuid, size: ComputerSize) -> Result<Quote, BillingError> {
        let (price_id, interval) = self.computer_price(team_id, size).await?;
        let price = self.teams.price(&price_id).await.map_err(billing_error)?;
        Ok(Quote {
            size,
            price_id,
            amount: price.amount,
            currency: price.currency,
            interval,
        })
    }

    #[tracing::instrument(skip(self, extra_items), fields(extra_items = extra_items.len()), err)]
    async fn add_computer(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        price_id: &stripe::PriceId,
        extra_items: &[SubscriptionItem],
        charge: ItemCharge,
        idempotency_key: &str,
    ) -> Result<SubscriptionItemId, BillingError> {
        if !self
            .teams
            .replay_subscription_item_change(idempotency_key)
            .await
            .map_err(billing_error)?
        {
            // A price of its own: a subscription cannot bill two items of one price.
            let computer_price = self
                .teams
                .create_computer_price(
                    price_id,
                    &computer_id.to_string(),
                    &format!("{idempotency_key}:price"),
                )
                .await
                .map_err(billing_error)?;
            let extra = extra_items
                .iter()
                .map(|item| ItemQuantityChange {
                    price_id: item.price_id.clone(),
                    delta: i64::from(item.quantity),
                })
                .collect();
            self.teams
                .add_team_computer_item(
                    &team_id,
                    &computer_price,
                    &computer_id.to_string(),
                    extra,
                    match charge {
                        ItemCharge::Prorated => ItemProration::InvoiceNow,
                        ItemCharge::NoProration => ItemProration::NoProration,
                    },
                    idempotency_key,
                )
                .await
                .map_err(billing_error)?;
        }
        // The update succeeded (now or before); its item carries the computer id.
        self.computer_item(team_id, computer_id)
            .await?
            .ok_or_else(|| {
                BillingError::Provider(rootcause::report!(
                    "the computer's subscription item was added but is not on the subscription"
                ))
            })
    }

    #[tracing::instrument(skip(self), err)]
    async fn settle_computer_add(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        idempotency_key: &str,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        let settlement = self
            .teams
            .settle_subscription_item_change(idempotency_key)
            .await
            .map_err(billing_error)?;
        tracing::info!(?settlement, "computer charge settled");
        // Either way, the subscription decides: an item carrying the computer
        // id means it is billed.
        match self.computer_item(team_id, computer_id).await {
            Err(BillingError::NoSubscription) => Ok(None),
            outcome => outcome,
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn computer_item(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<SubscriptionItemId>, BillingError> {
        let computer_id = computer_id.to_string();
        Ok(self
            .teams
            .team_subscription_items(&team_id)
            .await
            .map_err(billing_error)?
            .into_iter()
            .find(|item| item.computer_id.as_deref() == Some(computer_id.as_str()))
            .map(|item| item.id))
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_computer(
        &self,
        team_id: Uuid,
        subscription_item: &SubscriptionItemId,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        // Releasing a computer refunds nothing: release stops billing at
        // once, and cancel removes the item once the period is paid.
        match self
            .teams
            .remove_team_subscription_item(&team_id, subscription_item, idempotency_key)
            .await
            .map_err(billing_error)?
        {
            ItemRemoval::Removed => Ok(()),
            ItemRemoval::AlreadyGone => {
                tracing::info!(subscription_item = %subscription_item, "computer item was already gone");
                Ok(())
            }
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn period_end(&self, team_id: Uuid) -> Result<DateTime<Utc>, BillingError> {
        Ok(self
            .teams
            .team_subscription_terms(&team_id)
            .await
            .map_err(billing_error)?
            .current_period_end)
    }
}

fn billing_error(error: TeamSubscriptionItemsError) -> BillingError {
    match error {
        TeamSubscriptionItemsError::NoSubscription
        | TeamSubscriptionItemsError::Customer(CustomerError::SubscriptionNotActive) => {
            BillingError::NoSubscription
        }
        // An abandoned change is never sent again: nothing was charged.
        TeamSubscriptionItemsError::Customer(
            CustomerError::PaymentFailed | CustomerError::ItemChangeAbandoned,
        ) => BillingError::PaymentFailed,
        error => BillingError::Provider(rootcause::Report::new(error).into_dynamic()),
    }
}

#[async_trait::async_trait]
impl<Repo, Bill, Time, Attachment, Policy> ComputerBillingObserver
    for ComputerService<Repo, Bill, Time, Attachment, Policy>
where
    Repo: ComputerRepo,
    Bill: Billing,
    Time: Clock,
    Attachment: hosted_runtimes::domain::ports::FleetAttachmentSource,
    Policy: hosted_runtimes::domain::ports::CompPolicy,
{
    async fn subscription_observed(
        &self,
        team_id: Uuid,
        observed: SubscriptionObserved,
    ) -> Result<(), rootcause::Report> {
        self.observe_subscription(team_id, observed)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}
