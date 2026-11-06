//! The shared team-agent administrative rollout boundary.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

/// Rollout eligibility for an authenticated administrator, independent of team
/// authorization. Self-service secret operations must never call this port.
pub trait AgentAdminRollout: Send + Sync + 'static {
    /// True only for a successfully loaded, enabled per-user flag snapshot.
    fn enabled(&self, caller: &MacroUserIdStr<'_>) -> impl Future<Output = bool> + Send;
}
