//! What the inbox needs beyond the shared feed layer. A clear's storage is
//! the notification crate's bulk action store
//! (`notification::domain::bulk_action::BulkActionStore`).

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;

use super::models::ClearAction;

/// Tells the viewer's open sessions that a clear changed: started, moved on,
/// finished or was undone. Each session hides or restores the clear's rows
/// from it without waiting for the rows themselves to change.
pub trait ClearUpdates: Send + Sync + 'static {
    /// Best effort: failures are logged, never returned. Sessions that miss
    /// an update read the clear again when they reconnect.
    fn updated(
        &self,
        user: &MacroUserIdStr<'static>,
        action: &ClearAction,
    ) -> impl Future<Output = ()> + Send;
}
