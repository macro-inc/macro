//! Macro computers billed as items on the team subscription: their prices,
//! and the port that keeps purchased computers in step with what Stripe bills.

use stripe_price_id::StripePriceId;

use hosted_runtimes::domain::{models::BillingInterval, size::ComputerSize};

/// One size's price per billing interval; `None` when not sold at it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IntervalPrices {
    pub monthly: Option<StripePriceId>,
    pub yearly: Option<StripePriceId>,
}

impl IntervalPrices {
    fn price_id(&self, interval: BillingInterval) -> Option<&StripePriceId> {
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
    ) -> Option<&StripePriceId> {
        self.of(size).price_id(interval)
    }
}

/// Learns the complete subscription item snapshot after
/// every team subscription webhook, so computers whose items were removed
/// outside Macro (dashboard edits, cancellation) are cancelled too.
// Object-safe: `ApiContext` holds it as `Arc<dyn ComputerBillingObserver>`.
#[async_trait::async_trait]
pub trait ComputerBillingObserver: Send + Sync {
    async fn billed_counts(
        &self,
        team_id: uuid::Uuid,
        items: Vec<hosted_runtimes::domain::models::SubscriptionItem>,
    ) -> Result<(), rootcause::Report>;
}

#[cfg(test)]
mod test;
