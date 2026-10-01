//! Startup configuration for prospective AI quota enforcement.

use rootcause::prelude::ResultExt as _;

use crate::domain::counting::AiUsageEnforcement;

#[cfg(test)]
mod test;

// Keep configuration deserialization outside the domain policy. MacroConfig
// parses the raw Doppler/environment value as a strict boolean.
impl<'de> serde::Deserialize<'de> for AiUsageEnforcement {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let enabled = bool::deserialize(deserializer)?;
        Ok(if enabled {
            Self::Enabled
        } else {
            Self::Disabled
        })
    }
}

/// Load `ENABLE_AI_USAGE_ENFORCEMENT` once at service startup.
///
/// Missing means disabled. Only `true` and `false` are accepted when present;
/// malformed or non-Unicode values return an error that the host must propagate
/// to fail startup. This does not enable financial settlement; that is the
/// separately loaded `ENABLE_AI_USAGE_BILLING` policy.
pub fn load_ai_usage_enforcement() -> Result<AiUsageEnforcement, rootcause::Report> {
    if load_startup_flag("ENABLE_AI_USAGE_ENFORCEMENT")? {
        Ok(AiUsageEnforcement::Enabled)
    } else {
        Ok(AiUsageEnforcement::Disabled)
    }
}

/// Load a default-off `true`/`false` policy flag once at service startup.
///
/// Missing means `false`. Only raw `true` and `false` are accepted when present;
/// malformed or non-Unicode values return an error that the host must propagate
/// to fail startup.
///
/// Hosts using MacroConfig must call this loader as well: its defaulted fields
/// treat `null` as absent, but a present non-boolean flag must fail startup. The
/// returned value is authoritative (including process-env fallback when the
/// Doppler application configuration omits the key).
pub fn load_startup_flag(name: &'static str) -> Result<bool, rootcause::Report> {
    // Unlike maybe_env_var!, this preserves errors for present non-Unicode values.
    let value =
        macro_env_var::optional_read_env_var(name).context(format!("failed to read {name}"))?;
    parse_startup_flag(name, value.as_deref())
}

fn parse_startup_flag(name: &str, value: Option<&str>) -> Result<bool, rootcause::Report> {
    Ok(value
        .map(str::parse::<bool>)
        .transpose()
        .context(format!("{name} must be true or false"))?
        .unwrap_or(false))
}
