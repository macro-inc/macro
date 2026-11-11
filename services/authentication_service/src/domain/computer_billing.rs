//! Macro computers billed as items on the team subscription: their prices,
//! and the port that keeps purchased computers in step with what Stripe bills.

use hosted_runtimes::domain::{models::BillingInterval, size::ComputerSize};

/// One size's price per billing interval; `None` when not sold at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntervalPrices {
    pub monthly: Option<stripe::PriceId>,
    pub yearly: Option<stripe::PriceId>,
}

impl IntervalPrices {
    fn price_id(&self, interval: BillingInterval) -> Option<&stripe::PriceId> {
        match interval {
            BillingInterval::Month => self.monthly.as_ref(),
            BillingInterval::Year => self.yearly.as_ref(),
        }
    }
}

/// The Stripe prices computers are billed at. Not seat plans: seat
/// accounting ignores these prices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerPrices {
    pub standard: IntervalPrices,
    pub large: IntervalPrices,
    pub xl: IntervalPrices,
}

impl ComputerPrices {
    /// Whether this deployment has no computer billing prices configured.
    pub fn is_empty(&self) -> bool {
        ComputerSize::ALL.into_iter().all(|size| {
            let prices = self.of(size);
            prices.monthly.is_none() && prices.yearly.is_none()
        })
    }

    fn of(&self, size: ComputerSize) -> &IntervalPrices {
        match size {
            ComputerSize::Standard => &self.standard,
            ComputerSize::Large => &self.large,
            ComputerSize::Xl => &self.xl,
        }
    }

    /// The price one `size` computer bills at on an `interval` subscription.
    pub fn price_id(
        &self,
        size: ComputerSize,
        interval: BillingInterval,
    ) -> Option<&stripe::PriceId> {
        self.of(size).price_id(interval)
    }

    /// Recognize an unlinked legacy computer charge without inferring its size.
    pub fn contains_legacy_price(&self, price_id: &stripe::PriceId) -> bool {
        ComputerSize::ALL.into_iter().any(|size| {
            let prices = self.of(size);
            [prices.monthly.as_ref(), prices.yearly.as_ref()]
                .into_iter()
                .flatten()
                .any(|configured| configured == price_id)
        })
    }
}

/// Receives a complete team subscription snapshot after every team
/// subscription webhook. It only reports; `hosted_runtimes` decides what the
/// snapshot means for each computer (items matched by computer id).
// Object-safe: `ApiContext` holds it as `Arc<dyn ComputerBillingObserver>`.
#[async_trait::async_trait]
pub trait ComputerBillingObserver: Send + Sync {
    async fn subscription_observed(
        &self,
        team_id: uuid::Uuid,
        observed: hosted_runtimes::domain::service::SubscriptionObserved,
    ) -> Result<(), rootcause::Report>;
}

/// Releases a team's computers ahead of its deletion.
#[async_trait::async_trait]
pub trait TeamComputers: Send + Sync {
    async fn release_team(&self, team_id: uuid::Uuid) -> Result<(), rootcause::Report>;
}

#[async_trait::async_trait]
impl<Repo, Time> TeamComputers for hosted_runtimes::domain::service::TeamComputerRelease<Repo, Time>
where
    Repo: hosted_runtimes::domain::ports::ComputerRepo,
    Time: hosted_runtimes::domain::service::Clock,
{
    async fn release_team(&self, team_id: uuid::Uuid) -> Result<(), rootcause::Report> {
        hosted_runtimes::domain::service::TeamComputerRelease::release_team(self, team_id)
            .await
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }
}

#[cfg(test)]
mod test;
