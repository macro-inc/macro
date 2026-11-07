//! Which callers get dynamic multi-term matching on document content.

use macro_user_id::user_id::MacroUserIdStr;

/// Per-caller rollout of dynamic multi-term matching.
// Object-safe so `SearchHandlerState` can hold it without a type parameter.
#[async_trait::async_trait]
pub trait TermMatchingRollout: Send + Sync + 'static {
    /// Return false when the rollout is off for `caller` or cannot be read.
    async fn dynamic_enabled_for(&self, caller: MacroUserIdStr<'_>) -> bool;
}
