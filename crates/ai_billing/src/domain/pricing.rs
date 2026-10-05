//! The two numbers GTM owns, and the conversions between provider cost and
//! customer money that every billing path shares.
//!
//! Usage and the in-plan allowance are measured in **cost cents**: the
//! provider's public price for what was consumed, in whole cents. Credits,
//! overage charges, caps and credit packs are **customer cents**: what the
//! customer actually pays. The two meet only where usage runs past the
//! allowance, which is marked up by [`OVERAGE_MARKUP_PERCENT`].
//!
//! Change a constant and redeploy to change pricing. The exact-money
//! public-allowance policy in [`super::policy`] derives its figures from the
//! same two constants, so the ledger and that policy can never disagree.

#[cfg(test)]
mod test;

/// In-plan AI allowance per paid seat per billing period, in cents at
/// provider cost. The same for every paid plan until GTM defines otherwise.
pub const INCLUDED_ALLOWANCE_CENTS: i64 = 2_000;

/// Markup on usage beyond the allowance, as a whole percent of provider cost.
///
/// Whole percents only: the exact-money path prices public usage over a
/// denominator of 100 (`CustomerMoney::from_public_ratio`) and rejects finer
/// rates at runtime.
pub const OVERAGE_MARKUP_PERCENT: i64 = 5;

const _: () = assert!(INCLUDED_ALLOWANCE_CENTS >= 0);
const _: () = assert!(OVERAGE_MARKUP_PERCENT >= 0 && OVERAGE_MARKUP_PERCENT < 100);

const PERCENT: i64 = 100;

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

/// Customer cents owed for `cost_cents` of usage beyond the allowance.
///
/// Apply this to a period's *cumulative* chargeable cost and book the
/// difference from what was already covered, never to each increment:
/// `extra(1) + extra(1)` is 4 but `extra(2)` is 3.
pub fn extra_customer_cents(cost_cents: i64) -> i64 {
    let marked_up = cost_cents
        .max(0)
        .saturating_mul(PERCENT + OVERAGE_MARKUP_PERCENT);
    // Ceiling division; `i64::div_ceil` is not stable.
    marked_up.saturating_add(PERCENT - 1) / PERCENT
}

/// The most cost cents of usage that `customer_cents` pays for at the markup:
/// the largest `cost` with `extra_customer_cents(cost) <= customer_cents`.
pub fn cost_cents_covered_by(customer_cents: i64) -> i64 {
    customer_cents.max(0).saturating_mul(PERCENT) / (PERCENT + OVERAGE_MARKUP_PERCENT)
}
