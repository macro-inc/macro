//! Per-owner tool presentation policy. Flags never grant permission to tools.

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use std::{future::Future, pin::Pin};

#[cfg(test)]
mod test;

/// PostHog key evaluated for the authenticated session owner.
pub const AI_CODE_MODE: &str = "ai-code-mode";

/// Tool presentation for one conversational turn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum ToolMode {
    /// The normal direct Macro tools and lazy catalog.
    #[default]
    Standard,
    /// SDK operations are hidden from direct calls and discovery.
    Code,
}

/// Select a stable tool mode once per turn, using the session owner's identity.
pub trait ToolModeSelector: Send + Sync {
    /// Resolve presentation policy; unavailable flags retain standard tools.
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>>;
}

/// Default when this deployment has no feature-flag provider.
pub struct StandardTools;

impl ToolModeSelector for StandardTools {
    fn select<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        Box::pin(async { ToolMode::Standard })
    }
}

/// Loads the owner's flags and applies the code-mode rollout policy.
pub struct FlaggedToolMode<F> {
    flags: F,
}

impl<F: FeatureFlags> FlaggedToolMode<F> {
    /// Compose with a provider whose load has a bounded deadline.
    pub fn new(flags: F) -> Self {
        Self { flags }
    }
}

impl<F: FeatureFlags> ToolModeSelector for FlaggedToolMode<F> {
    fn select<'a>(
        &'a self,
        owner: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        Box::pin(async move {
            let flags = self
                .flags
                .load(owner)
                .await
                .inspect_err(|error| {
                    tracing::warn!(
                        ?error,
                        "feature flags unavailable; retaining standard agent tools"
                    );
                })
                .unwrap_or_default();
            if flags.is_enabled(AI_CODE_MODE) {
                ToolMode::Code
            } else {
                ToolMode::Standard
            }
        })
    }
}

/// Account facts could not be loaded; never assume a different identity.
#[derive(Debug, thiserror::Error)]
#[error("agent account lookup unavailable")]
pub struct AgentAccountError;

/// Account facts resolved by the server, never from MCP client headers.
pub trait AgentAccounts: Send + Sync {
    /// Whether this authenticated user is an agent teammate.
    fn is_teammate<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = Result<bool, AgentAccountError>> + Send + 'a>>;
}

/// Explicit `ai-code-mode` rule: teammates always use SDK code mode; other
/// users retain their existing per-user rollout policy. Permissions stay unchanged.
pub struct AgentToolMode<A> {
    accounts: A,
    other: std::sync::Arc<dyn ToolModeSelector>,
}
impl<A: AgentAccounts> AgentToolMode<A> {
    /// Compose authoritative account facts with the ordinary flag selector.
    pub fn new(accounts: A, other: std::sync::Arc<dyn ToolModeSelector>) -> Self {
        Self { accounts, other }
    }
}
impl<A: AgentAccounts> ToolModeSelector for AgentToolMode<A> {
    fn select<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> Pin<Box<dyn Future<Output = ToolMode> + Send + 'a>> {
        Box::pin(async move {
            match self.accounts.is_teammate(user).await {
                Ok(true) => ToolMode::Code,
                Ok(false) => self.other.select(user).await,
                Err(_) => {
                    // Fail closed. Brain discovery rejects missing code-mode tools
                    // rather than starting a turn with a different capability set.
                    tracing::error!("could not resolve MCP teammate code-mode rule");
                    ToolMode::Standard
                }
            }
        })
    }
}
