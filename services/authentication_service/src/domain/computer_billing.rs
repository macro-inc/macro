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

    fn contains(&self, price_id: &str) -> bool {
        self.monthly.as_ref().map(StripePriceId::as_str) == Some(price_id)
            || self.yearly.as_ref().map(StripePriceId::as_str) == Some(price_id)
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

    /// The size a subscription item's price bills, if it is a computer price.
    pub fn size_for_price(&self, price_id: &str) -> Option<ComputerSize> {
        ComputerSize::ALL
            .into_iter()
            .find(|size| self.of(*size).contains(price_id))
    }

    /// How many computers of every size `items` (price id, quantity) bill.
    pub fn billed_counts<'a>(
        &self,
        items: impl IntoIterator<Item = (&'a str, u64)>,
    ) -> [(ComputerSize, u32); 3] {
        let mut counts = ComputerSize::ALL.map(|size| (size, 0u32));
        for (price_id, quantity) in items {
            if let Some(size) = self.size_for_price(price_id)
                && let Some((_, count)) = counts.iter_mut().find(|(s, _)| *s == size)
            {
                *count = count.saturating_add(u32::try_from(quantity).unwrap_or(u32::MAX));
            }
        }
        counts
    }
}

/// Learns how many computers of a size the team subscription bills, after
/// every team subscription webhook, so computers whose items were removed
/// outside Macro (dashboard edits, cancellation) are cancelled too.
// Object-safe: `ApiContext` holds it as `Arc<dyn ComputerBillingObserver>`.
#[async_trait::async_trait]
pub trait ComputerBillingObserver: Send + Sync {
    async fn billed_count(
        &self,
        team_id: uuid::Uuid,
        size: ComputerSize,
        billed: u32,
    ) -> Result<(), rootcause::Report>;
}

#[cfg(test)]
mod test;
