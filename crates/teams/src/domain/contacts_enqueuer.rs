//! Outbound port for the contacts changes team membership causes.
//!
//! The teams service uses this port to delete the legacy connections team
//! joins once wrote, once the membership ends, and to tell members whose teammates
//! changed which contacts to re-read, without depending on a particular queue
//! or contacts service implementation.

use macro_user_id::user_id::MacroUserIdStr;
use std::convert::Infallible;

/// Enqueues the contacts changes a team membership change causes.
pub trait ContactsEnqueuer: Clone + Send + Sync + 'static {
    /// Error type returned by enqueue operations.
    type Err: std::fmt::Display + std::fmt::Debug + Send;

    /// Enqueues pairs of users who stopped being teammates, so the legacy
    /// connection a team join once wrote for them is deleted.
    fn enqueue_contact_disconnections(
        &self,
        disconnections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Tells each user's clients to re-read `changed`. Teammates are computed
    /// from the roster, so nothing is written. Empty means unknown: the
    /// clients fall back to their periodic scan.
    fn directory_changed(
        &self,
        users: Vec<MacroUserIdStr<'static>>,
        changed: Vec<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op contact enqueuer for callers that do not need contact synchronization.
#[derive(Clone, Debug)]
pub struct NoOpContactsEnqueuer;

impl ContactsEnqueuer for NoOpContactsEnqueuer {
    type Err = Infallible;

    async fn enqueue_contact_disconnections(
        &self,
        _disconnections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }

    async fn directory_changed(
        &self,
        _users: Vec<MacroUserIdStr<'static>>,
        _changed: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
