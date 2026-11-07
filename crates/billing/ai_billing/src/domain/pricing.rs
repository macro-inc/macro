//! The numbers GTM owns and the conversions between provider cost and
//! customer money that every billing path shares.
//!
//! Usage and the in-plan allowances are measured in **cost cents**: the
//! provider's public price for what was consumed, in whole cents. Credits,
//! overage charges, caps and credit packs are **customer cents**: what the
//! customer actually pays. The two meet only where paid usage runs past the
//! allowance, which is marked up by [`AiPricing::overage_markup_percent`].
//!
//! None of the numbers live in code. Every host reads the mandatory
//! `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS`, `AI_USAGE_INCLUDED_ALLOWANCE_CENTS`
//! (Premium), `AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS` and
//! `AI_USAGE_OVERAGE_MARKUP_PERCENT` from Doppler at startup (see
//! [`crate::config`]) and injects one [`AiPricing`] into each billing component
//! it composes. Change the values in Doppler and redeploy to change pricing.
//! The exact-money public-allowance policy in [`super::policy`] derives its
//! figures from the same values, so the ledger and that policy can never
//! disagree.

#[cfg(test)]
mod test;

use super::models::PlanTier;
use thiserror::Error;

/// Why a pricing value was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Error)]
pub enum PricingError {
    /// The allowance must be zero or more cents.
    #[error("included allowance must be at least 0 cents, got {0}")]
    NegativeAllowance(i64),
    /// The markup must be a whole percent from 0 to 99.
    #[error("overage markup must be a whole percent from 0 to 99, got {0}")]
    MarkupOutOfRange(i64),
}

/// In-plan AI allowance per seat per billing period for one plan, in cents at
/// provider cost.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct IncludedAllowanceCents(i64);

impl IncludedAllowanceCents {
    /// Validate an allowance: any non-negative number of cents.
    pub const fn new(cents: i64) -> Result<Self, PricingError> {
        if cents < 0 {
            Err(PricingError::NegativeAllowance(cents))
        } else {
            Ok(Self(cents))
        }
    }

    /// The allowance in cost cents.
    pub const fn cents(self) -> i64 {
        self.0
    }
}

/// Markup on usage beyond the allowance, as a whole percent of provider cost.
///
/// Whole percents below 100 only: the exact-money path prices public usage
/// over a denominator of 100 (`CustomerMoney::from_public_ratio`) and rejects
/// finer rates at runtime.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct OverageMarkupPercent(i64);

impl OverageMarkupPercent {
    /// Validate a markup: a whole percent from 0 to 99.
    pub const fn new(percent: i64) -> Result<Self, PricingError> {
        if percent < 0 || percent >= PERCENT {
            Err(PricingError::MarkupOutOfRange(percent))
        } else {
            Ok(Self(percent))
        }
    }

    /// The markup as a whole percent.
    pub const fn percent(self) -> i64 {
        self.0
    }
}

/// The in-plan allowance of every plan, so no component can be composed with
/// one tier's allowance and not another's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlanAllowances {
    /// The free plan's hard monthly cap. Free users cannot buy credits or
    /// enable overage, so this is all the AI they get until they upgrade.
    pub free: IncludedAllowanceCents,
    /// Included AI per Premium seat per period.
    pub premium: IncludedAllowanceCents,
    /// Included AI per Max seat per period.
    pub max: IncludedAllowanceCents,
}

impl PlanAllowances {
    /// The allowance for `tier`, in cost cents.
    pub const fn for_tier(self, tier: PlanTier) -> IncludedAllowanceCents {
        match tier {
            PlanTier::Free => self.free,
            PlanTier::Premium => self.premium,
            PlanTier::Max => self.max,
        }
    }
}

/// The configured pricing. Allowances and markup travel together so no
/// component can be composed with one and not the other.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AiPricing {
    allowances: PlanAllowances,
    overage_markup: OverageMarkupPercent,
}

const PERCENT: i64 = 100;

impl AiPricing {
    /// Combine the validated values.
    pub const fn new(allowances: PlanAllowances, overage_markup: OverageMarkupPercent) -> Self {
        Self {
            allowances,
            overage_markup,
        }
    }

    /// Every plan's allowance.
    pub const fn allowances(self) -> PlanAllowances {
        self.allowances
    }

    /// In-plan AI allowance per seat per period for `tier`, in cents at
    /// provider cost.
    pub const fn included_allowance_cents_for(self, tier: PlanTier) -> i64 {
        self.allowances.for_tier(tier).cents()
    }

    /// The default paid plan's (Premium's) allowance per seat per period, in
    /// cents at provider cost. Prefer [`Self::included_allowance_cents_for`]
    /// whenever the tier is known.
    pub const fn included_allowance_cents(self) -> i64 {
        self.allowances.premium.cents()
    }

    /// Markup on usage beyond the allowance, as a whole percent of provider cost.
    pub const fn overage_markup_percent(self) -> i64 {
        self.overage_markup.percent()
    }

    /// Customer cents owed for `cost_cents` of usage beyond the allowance.
    ///
    /// Apply this to a period's *cumulative* chargeable cost and book the
    /// difference from what was already covered, never to each increment:
    /// at 5%, `extra(1) + extra(1)` is 4 but `extra(2)` is 3.
    pub fn extra_customer_cents(self, cost_cents: i64) -> i64 {
        let marked_up = cost_cents
            .max(0)
            .saturating_mul(PERCENT + self.overage_markup_percent());
        // Ceiling division; `i64::div_ceil` is not stable.
        marked_up.saturating_add(PERCENT - 1) / PERCENT
    }

    /// The most cost cents of usage that `customer_cents` pays for at the
    /// markup: the largest `cost` with `extra_customer_cents(cost) <= customer_cents`.
    pub fn cost_cents_covered_by(self, customer_cents: i64) -> i64 {
        customer_cents.max(0).saturating_mul(PERCENT) / (PERCENT + self.overage_markup_percent())
    }
}

/// Provider cost in USD to whole cents at cost, rounded up so fractions of a
/// cent never accrue in the customer's favour. Non-finite and non-positive
/// amounts are zero.
///
/// The product is first rounded to a millionth of a cent: provider totals are
/// summed as binary floating point, and `0.07 * 100.0` is `7.000000000000001`,
/// which a bare `ceil` would charge as 8.
pub fn cost_cents(provider_cost_usd: f64) -> i64 {
    if !provider_cost_usd.is_finite() || provider_cost_usd <= 0.0 {
        return 0;
    }
    let micro_cents = (provider_cost_usd * 100.0 * 1_000_000.0).round();
    (micro_cents / 1_000_000.0).ceil() as i64
}

#[cfg(test)]
impl AiPricing {
    /// The $5 free cap, $20 Premium and $100 Max allowances, and 5% markup
    /// the crate's tests assume.
    pub(crate) fn testing() -> Self {
        Self::new(
            PlanAllowances::testing(),
            OverageMarkupPercent::new(5).unwrap(),
        )
    }
}

#[cfg(test)]
impl PlanAllowances {
    /// The $5 free cap, $20 Premium and $100 Max allowances the crate's tests assume.
    pub(crate) fn testing() -> Self {
        Self {
            free: IncludedAllowanceCents::new(500).unwrap(),
            premium: IncludedAllowanceCents::new(2_000).unwrap(),
            max: IncludedAllowanceCents::new(10_000).unwrap(),
        }
    }

    /// Every plan on the same allowance (for tests of tier-independent arithmetic).
    pub(crate) fn uniform(cents: i64) -> Self {
        let allowance = IncludedAllowanceCents::new(cents).unwrap();
        Self {
            free: allowance,
            premium: allowance,
            max: allowance,
        }
    }
}
