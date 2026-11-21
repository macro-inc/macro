//! The dev-only rollout allowlist as a service's configuration supplies it.

use macro_env::Environment;

use crate::domain::rollout::{RolloutAllowlist, RolloutAllowlistError};

/// Parse `COMPUTERS_ROLLOUT_ALLOWLIST` for `environment`; production refuses any value.
pub fn configured(
    raw: Option<&str>,
    environment: Environment,
) -> Result<RolloutAllowlist, RolloutAllowlistError> {
    RolloutAllowlist::parse(raw, matches!(environment, Environment::Production))
}

#[cfg(test)]
mod test;
