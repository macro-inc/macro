//! Fail-closed, per-user rollout for new computer surfaces.

use std::{future::Future, pin::Pin, sync::Arc};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// Shared web and backend rollout key.
pub const ENABLE_MACRO_COMPUTERS: &str = "enable-macro-computers";

type Evaluate =
    dyn Fn(MacroUserIdStr<'static>) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync;

/// Macro users who get computers whatever the flag says, for testing a
/// deployment before its PostHog targeting exists (`COMPUTERS_ROLLOUT_ALLOWLIST`,
/// comma-separated Macro user ids). Never allowed in production.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RolloutAllowlist(Vec<MacroUserIdStr<'static>>);

/// The allowlist could not be accepted; never carries the configured ids.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum RolloutAllowlistError {
    /// Production rolls computers out through PostHog only.
    #[error("COMPUTERS_ROLLOUT_ALLOWLIST must not be set in production")]
    Production,
    /// An entry is not a Macro user id.
    #[error("COMPUTERS_ROLLOUT_ALLOWLIST entry {0} is not a Macro user id")]
    InvalidEntry(usize),
}

impl RolloutAllowlist {
    /// Parse the configured value; unset or blank is empty.
    pub fn parse(raw: Option<&str>, production: bool) -> Result<Self, RolloutAllowlistError> {
        let Some(raw) = raw.map(str::trim).filter(|raw| !raw.is_empty()) else {
            return Ok(Self::default());
        };
        if production {
            return Err(RolloutAllowlistError::Production);
        }
        raw.split(',')
            .map(str::trim)
            .enumerate()
            .map(|(index, entry)| {
                MacroUserIdStr::try_from(entry.to_owned())
                    .map_err(|_| RolloutAllowlistError::InvalidEntry(index))
            })
            .collect::<Result<_, _>>()
            .map(Self)
    }

    fn contains(&self, user_id: &MacroUserIdStr<'_>) -> bool {
        self.0
            .iter()
            .any(|allowed| allowed.as_ref() == user_id.as_ref())
    }
}

/// Missing providers, failed evaluations and missing flags all disable rollout.
#[derive(Clone, Default)]
pub struct ComputerRollout {
    evaluate: Option<Arc<Evaluate>>,
    allowlist: RolloutAllowlist,
}

impl ComputerRollout {
    /// Compose once with the service's bounded feature-flag provider.
    pub fn new<Flags: FeatureFlags + 'static>(flags: Flags) -> Self {
        let flags = Arc::new(flags);
        Self {
            evaluate: Some(Arc::new(move |user| {
                let flags = Arc::clone(&flags);
                Box::pin(async move {
                    flags
                        .load(&user)
                        .await
                        .inspect_err(|error| {
                            tracing::warn!(?error, "computer rollout unavailable; refusing access");
                        })
                        .unwrap_or_default()
                        .is_enabled(ENABLE_MACRO_COMPUTERS)
                })
            })),
            allowlist: RolloutAllowlist::default(),
        }
    }

    /// Also admit these users, flag or not (dev only; see [`RolloutAllowlist`]).
    pub fn with_allowlist(mut self, allowlist: RolloutAllowlist) -> Self {
        self.allowlist = allowlist;
        self
    }

    /// Evaluate the authenticated Macro user, never a team or derived identity.
    #[tracing::instrument(skip_all)]
    pub async fn enabled(&self, user_id: &MacroUserIdStr<'static>) -> bool {
        if self.allowlist.contains(user_id) {
            return true;
        }
        let Some(evaluate) = &self.evaluate else {
            return false;
        };
        evaluate(user_id.clone()).await
    }
}

#[cfg(test)]
mod test;
