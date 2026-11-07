//! Startup configuration for AI usage settlement and pricing.
//!
//! Pricing is four mandatory Doppler values, read once at startup by every
//! host that composes this crate:
//!
//! | Key | Meaning |
//! | --- | --- |
//! | `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS` | The free plan's hard monthly AI cap, cents at provider cost |
//! | `AI_USAGE_INCLUDED_ALLOWANCE_CENTS` | In-plan AI per Premium seat per period, cents at provider cost |
//! | `AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS` | In-plan AI per Max seat per period, cents at provider cost |
//! | `AI_USAGE_OVERAGE_MARKUP_PERCENT` | Markup on paid usage past the allowance, a whole percent (0-99) |
//!
//! Hosts on MacroConfig declare them as required fields of their `Config`
//! using [`IncludedAllowanceCents`] and [`OverageMarkupPercent`] directly, so a
//! missing, malformed or out-of-range value fails config loading (and the
//! Doppler CI validator) rather than a request. Hosts reading plain env vars
//! parse the raw strings with [`parse_ai_pricing`].

use crate::domain::{
    AiPricing, AiUsageBilling, IncludedAllowanceCents, OverageMarkupPercent, PlanAllowances,
};
use rootcause::prelude::ResultExt as _;
use serde::de::Error as _;

#[cfg(test)]
mod test;

/// Doppler key for the free plan's monthly cap.
pub const AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS: &str = "AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS";
/// Doppler key for the Premium (default paid plan) allowance.
pub const AI_USAGE_INCLUDED_ALLOWANCE_CENTS: &str = "AI_USAGE_INCLUDED_ALLOWANCE_CENTS";
/// Doppler key for the Max allowance.
pub const AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS: &str = "AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS";
/// Doppler key for the overage markup.
pub const AI_USAGE_OVERAGE_MARKUP_PERCENT: &str = "AI_USAGE_OVERAGE_MARKUP_PERCENT";

/// The raw allowance values a host read itself, one per plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RawPlanAllowances<'a> {
    /// `AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS`.
    pub free: &'a str,
    /// `AI_USAGE_INCLUDED_ALLOWANCE_CENTS`.
    pub premium: &'a str,
    /// `AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS`.
    pub max: &'a str,
}

// Keep configuration deserialization outside the domain policy. MacroConfig
// parses the raw Doppler/environment value as a strict boolean.
impl<'de> serde::Deserialize<'de> for AiUsageBilling {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let enabled = bool::deserialize(deserializer)?;
        Ok(if enabled {
            Self::Enabled
        } else {
            Self::Disabled
        })
    }
}

// The pricing newtypes deserialize from the raw Doppler number. MacroConfig
// parses the string value as an integer; anything malformed or out of range
// fails config loading, and so startup. The same allowance type backs every
// plan's key, so the message names the kind of value rather than one key.
impl<'de> serde::Deserialize<'de> for IncludedAllowanceCents {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let cents = i64::deserialize(deserializer)?;
        Self::new(cents).map_err(|error| D::Error::custom(format!("AI usage allowance: {error}")))
    }
}

impl<'de> serde::Deserialize<'de> for OverageMarkupPercent {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let percent = i64::deserialize(deserializer)?;
        Self::new(percent).map_err(|error| {
            D::Error::custom(format!("{AI_USAGE_OVERAGE_MARKUP_PERCENT}: {error}"))
        })
    }
}

fn parse_allowance(
    key: &'static str,
    raw: &str,
) -> Result<IncludedAllowanceCents, rootcause::Report> {
    let cents = raw
        .trim()
        .parse::<i64>()
        .context(format!("{key} must be a whole number of cents"))?;
    Ok(IncludedAllowanceCents::new(cents).context(key)?)
}

/// Build the pricing from the raw allowance and
/// `AI_USAGE_OVERAGE_MARKUP_PERCENT` values a host read itself. Hosts on
/// MacroConfig declare the typed fields instead and need no parsing.
///
/// Every value is mandatory; the host must propagate an error to fail startup.
pub fn parse_ai_pricing(
    allowances: RawPlanAllowances<'_>,
    overage_markup_percent: &str,
) -> Result<AiPricing, rootcause::Report> {
    let allowances = PlanAllowances {
        free: parse_allowance(AI_USAGE_FREE_INCLUDED_ALLOWANCE_CENTS, allowances.free)?,
        premium: parse_allowance(AI_USAGE_INCLUDED_ALLOWANCE_CENTS, allowances.premium)?,
        max: parse_allowance(AI_USAGE_MAX_INCLUDED_ALLOWANCE_CENTS, allowances.max)?,
    };
    let percent = overage_markup_percent
        .trim()
        .parse::<i64>()
        .context(format!(
            "{AI_USAGE_OVERAGE_MARKUP_PERCENT} must be a whole percent"
        ))?;
    let markup = OverageMarkupPercent::new(percent).context(AI_USAGE_OVERAGE_MARKUP_PERCENT)?;
    Ok(AiPricing::new(allowances, markup))
}

/// Load `ENABLE_AI_USAGE_BILLING` once at service startup.
///
/// Missing means disabled. Only `true` and `false` are accepted when present;
/// malformed or non-Unicode values return an error that the host must propagate
/// to fail startup. Hosts using MacroConfig must call this loader as well, for
/// the same reasons as [`ai_usage::config::load_ai_usage_enforcement`]. This
/// policy does not enable quota admission or usage counting.
pub fn load_ai_usage_billing() -> Result<AiUsageBilling, rootcause::Report> {
    if ai_usage::config::load_startup_flag("ENABLE_AI_USAGE_BILLING")? {
        Ok(AiUsageBilling::Enabled)
    } else {
        Ok(AiUsageBilling::Disabled)
    }
}
