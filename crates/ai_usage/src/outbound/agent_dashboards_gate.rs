//! The agent dashboards flag through `feature_flags`.

use crate::domain::spend::{AgentDashboardsGate, ENABLE_AGENT_DASHBOARDS};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

/// [`AgentDashboardsGate`] over per-user feature flags. `None` (no PostHog
/// key configured) is off for everyone.
pub struct FlaggedAgentDashboards<F>(pub Option<F>);

impl<F: FeatureFlags + 'static> AgentDashboardsGate for FlaggedAgentDashboards<F> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> bool {
        let Some(flags) = &self.0 else {
            return false;
        };

        match flags.load(user).await {
            Ok(snapshot) => snapshot.is_enabled(ENABLE_AGENT_DASHBOARDS),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the agent dashboards flag");
                false
            }
        }
    }
}
