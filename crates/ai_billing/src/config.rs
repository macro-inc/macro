//! Startup configuration for AI usage settlement.

use crate::domain::AiUsageBilling;

#[cfg(test)]
mod test;

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
