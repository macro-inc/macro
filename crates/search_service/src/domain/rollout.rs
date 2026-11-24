//! Per-caller rollout switches for search features.

use macro_user_id::user_id::MacroUserIdStr;

/// Whether a search feature is on for a caller. A rollout switch, never an
/// access check.
// Object-safe so `SearchHandlerState` can hold it without a type parameter.
#[async_trait::async_trait]
pub trait SearchRollout: Send + Sync + 'static {
    /// Return false when the rollout is off for `caller` or cannot be read.
    async fn enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool;
}
