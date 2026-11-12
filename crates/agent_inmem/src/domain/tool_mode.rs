//! Which tools a turn presents.

use std::{future::Future, pin::Pin};

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

#[cfg(test)]
mod test;

/// Tool presentation for one turn.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ToolMode {
    /// The direct Macro tools: turns that cannot run code (summaries,
    /// sessions without a user owner, or no code runner reachable).
    Standard,
    /// Code mode: the SDK replaces every direct tool it covers.
    Code,
}

/// PostHog key evaluated for the session owner.
pub const AI_SESSION_CODE_MODE_ONLY: &str = "ai-session-code-mode-only";

/// Whether an owner's turns never fall back to the direct tools: summaries
/// run code mode too, and a turn whose code runner is missing fails.
pub trait CodeModeOnlyPolicy: Send + Sync {
    /// Whether `owner`'s turns are code mode only; unavailable flags are not.
    fn requires<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>>;
}

/// Default when this deployment has no feature-flag provider.
pub struct DirectFallback;

impl CodeModeOnlyPolicy for DirectFallback {
    fn requires<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async { false })
    }
}

/// Code mode only for owners with [`AI_SESSION_CODE_MODE_ONLY`].
pub struct FlaggedCodeModeOnly<F> {
    flags: F,
}

impl<F: FeatureFlags> FlaggedCodeModeOnly<F> {
    /// Compose with a provider whose load has a bounded deadline.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags> CodeModeOnlyPolicy for FlaggedCodeModeOnly<F> {
    fn requires<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = bool> + Send + 'a>> {
        Box::pin(async move {
            self.flags
                .load(owner)
                .await
                .inspect_err(|error| {
                    tracing::warn!(
                        ?error,
                        "feature flags unavailable; direct tools stay the fallback"
                    );
                })
                .unwrap_or_default()
                .is_enabled(AI_SESSION_CODE_MODE_ONLY)
        })
    }
}
