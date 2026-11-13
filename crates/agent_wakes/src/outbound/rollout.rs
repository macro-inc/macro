//! `enable-agent-dashboards`, per user.

use feature_flags::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::DashboardsRollout;

/// The flag key, identical to the web registry's.
pub const AGENT_DASHBOARDS_FLAG: &str = "enable-agent-dashboards";

/// [`DashboardsRollout`] over the shared feature-flag evaluator.
#[derive(Clone)]
pub struct FlaggedDashboards<F>(pub F);

impl<F: FeatureFlags + Send + Sync + 'static> DashboardsRollout for FlaggedDashboards<F> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'static>) -> bool {
        match self.0.load(user).await {
            Ok(flags) => flags.is_enabled(AGENT_DASHBOARDS_FLAG),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the agent dashboards flag");
                false
            }
        }
    }
}

/// The flag on for everyone, for local stacks only; chosen at the
/// composition root.
#[derive(Clone, Copy)]
pub struct LocalDashboardsFlags;

impl FeatureFlags for LocalDashboardsFlags {
    async fn load(&self, _: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, rootcause::Report> {
        Ok(FlagSnapshot::new([(
            AGENT_DASHBOARDS_FLAG.into(),
            FlagValue::Boolean(true),
        )]))
    }
}

/// The flag off for everyone: a deployed service with no flag evaluator.
#[derive(Clone, Copy)]
pub struct NoDashboards;

impl DashboardsRollout for NoDashboards {
    async fn enabled_for(&self, _: &MacroUserIdStr<'static>) -> bool {
        false
    }
}
