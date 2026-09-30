//! Startup configuration for prospective AI quota enforcement.

use rootcause::prelude::ResultExt as _;

use crate::domain::counting::AiUsageEnforcement;

#[cfg(test)]
mod test;

/// Load `ENABLE_AI_USAGE_ENFORCEMENT` once at service startup.
///
/// Missing means disabled. Only `true` and `false` are accepted when present;
/// malformed or non-Unicode values return an error that the host must propagate
/// to fail startup. This does not enable financial settlement.
pub fn load_ai_usage_enforcement() -> Result<AiUsageEnforcement, rootcause::Report> {
    // Unlike maybe_env_var!, this preserves errors for present non-Unicode values.
    let value = macro_env_var::optional_read_env_var("ENABLE_AI_USAGE_ENFORCEMENT")
        .context("failed to read ENABLE_AI_USAGE_ENFORCEMENT")?;
    parse_enforcement(value.as_deref())
}

fn parse_enforcement(value: Option<&str>) -> Result<AiUsageEnforcement, rootcause::Report> {
    let enabled = value
        .map(str::parse::<bool>)
        .transpose()
        .context("ENABLE_AI_USAGE_ENFORCEMENT must be true or false")?
        .unwrap_or(false);
    if enabled {
        Ok(AiUsageEnforcement::Enabled)
    } else {
        Ok(AiUsageEnforcement::Disabled)
    }
}
