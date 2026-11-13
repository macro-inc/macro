//! The dashboards flag through `feature_flags`.

use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::ENABLE_AGENT_DASHBOARDS;
use crate::domain::ports::DashboardGate;

/// [`DashboardGate`] over per-user feature flags.
pub struct FlaggedDashboards<F>(pub F);

impl<F: FeatureFlags + 'static> DashboardGate for FlaggedDashboards<F> {
    async fn enabled_for(&self, user: &MacroUserIdStr<'_>) -> bool {
        match self.0.load(user).await {
            Ok(flags) => flags.is_enabled(ENABLE_AGENT_DASHBOARDS),
            Err(error) => {
                tracing::warn!(error = ?error, "failed to load the dashboards flag");
                false
            }
        }
    }
}
