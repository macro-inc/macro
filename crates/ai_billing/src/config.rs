//! Startup configuration for AI usage settlement and pricing.
//!
//! Pricing is two mandatory Doppler values, read once at startup by every
//! host that composes this crate:
//!
//! | Key | Meaning |
//! | --- | --- |
//! | `AI_USAGE_INCLUDED_ALLOWANCE_CENTS` | In-plan AI per paid seat per period, cents at provider cost |
//! | `AI_USAGE_OVERAGE_MARKUP_PERCENT` | Markup on usage past the allowance, a whole percent (0-99) |
//!
//! Hosts on MacroConfig declare them as required fields of their `Config`
//! using [`IncludedAllowanceCents`] and [`OverageMarkupPercent`] directly, so a
//! missing, malformed or out-of-range value fails config loading (and the
//! Doppler CI validator) rather than a request. Hosts reading plain env vars
//! parse the raw strings with [`parse_ai_pricing`].

use crate::domain::{AiPricing, AiUsageBilling, IncludedAllowanceCents, OverageMarkupPercent};
use rootcause::prelude::ResultExt as _;
use serde::de::Error as _;

#[cfg(test)]
mod test;

/// Doppler key for the in-plan allowance.
pub const AI_USAGE_INCLUDED_ALLOWANCE_CENTS: &str = "AI_USAGE_INCLUDED_ALLOWANCE_CENTS";
/// Doppler key for the overage markup.
pub const AI_USAGE_OVERAGE_MARKUP_PERCENT: &str = "AI_USAGE_OVERAGE_MARKUP_PERCENT";

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
// fails config loading, and so startup.
impl<'de> serde::Deserialize<'de> for IncludedAllowanceCents {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let cents = i64::deserialize(deserializer)?;
        Self::new(cents).map_err(|error| {
            D::Error::custom(format!("{AI_USAGE_INCLUDED_ALLOWANCE_CENTS}: {error}"))
        })
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

/// Build the pricing from the raw `AI_USAGE_INCLUDED_ALLOWANCE_CENTS` and
/// `AI_USAGE_OVERAGE_MARKUP_PERCENT` values a host read itself. Hosts on
/// MacroConfig declare the typed fields instead and need no parsing.
///
/// Both values are mandatory; the host must propagate an error to fail startup.
pub fn parse_ai_pricing(
    included_allowance_cents: &str,
    overage_markup_percent: &str,
) -> Result<AiPricing, rootcause::Report> {
    let cents = included_allowance_cents
        .trim()
        .parse::<i64>()
        .context(format!(
            "{AI_USAGE_INCLUDED_ALLOWANCE_CENTS} must be a whole number of cents"
        ))?;
    let allowance =
        IncludedAllowanceCents::new(cents).context(AI_USAGE_INCLUDED_ALLOWANCE_CENTS)?;
    let percent = overage_markup_percent
        .trim()
        .parse::<i64>()
        .context(format!(
            "{AI_USAGE_OVERAGE_MARKUP_PERCENT} must be a whole percent"
        ))?;
    let markup = OverageMarkupPercent::new(percent).context(AI_USAGE_OVERAGE_MARKUP_PERCENT)?;
    Ok(AiPricing::new(allowance, markup))
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
