//! Macro computers billed on the team subscription through `teams`, and the
//! webhook observer that reconciles them through `hosted_runtimes`.

use chrono::{DateTime, Utc};
use hosted_runtimes::domain::{
    models::{BillingInterval, Quote, SubscriptionItem},
    ports::{Billing, BillingError, ComputerRepo},
    service::{Clock, ComputerService},
    size::ComputerSize,
};
use teams::domain::{
    model::{BillingCadence, CustomerError, ItemQuantityChange},
    subscription_items::{TeamSubscriptionItems, TeamSubscriptionItemsError},
};
use uuid::Uuid;

use crate::domain::computer_billing::{ComputerBillingObserver, ComputerPrices};

#[cfg(test)]
mod test;

/// [`Billing`] on the team subscription: one item per computer price, at
/// the subscription's interval.
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
        price_id: &stripe::PriceId,
        extra_items: &[SubscriptionItem],
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        if self
            .teams
            .replay_subscription_item_change(idempotency_key)
            .await
            .map_err(billing_error)?
        {
            return Ok(());
        }
        let changes = std::iter::once(ItemQuantityChange {
            price_id: price_id.clone(),
            delta: 1,
        })
        .chain(extra_items.iter().map(|item| ItemQuantityChange {
            price_id: item.price_id.clone(),
            delta: i64::from(item.quantity),
        }))
        .collect();
        self.teams
            .change_team_subscription_items(&team_id, changes, idempotency_key)
            .await
            .map_err(billing_error)
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_computer(
        &self,
        team_id: Uuid,
        price_id: &stripe::PriceId,
        idempotency_key: &str,
    ) -> Result<(), BillingError> {
        if self
            .teams
            .replay_subscription_item_change(idempotency_key)
            .await
            .map_err(billing_error)?
        {
            return Ok(());
        }
        self.teams
            .change_team_subscription_items(
                &team_id,
                vec![ItemQuantityChange {
                    price_id: price_id.clone(),
                    delta: -1,
                }],
                idempotency_key,
            )
            .await
            .map_err(billing_error)
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
        TeamSubscriptionItemsError::Customer(CustomerError::PaymentFailed) => {
            BillingError::PaymentFailed
        }
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
    async fn billed_counts(
        &self,
        team_id: Uuid,
        items: Vec<SubscriptionItem>,
    ) -> Result<(), rootcause::Report> {
        self.reconcile_billed_counts(team_id, &items)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}
