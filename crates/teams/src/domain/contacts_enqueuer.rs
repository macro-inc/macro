//! Outbound port for enqueueing contact connections created through team membership.
//!
//! The teams service uses this port to publish explicit connections between a
//! joining user and their teammates without depending on a particular queue or
//! contacts service implementation.

use macro_user_id::user_id::MacroUserIdStr;
use std::convert::Infallible;

/// Enqueues contact connections created when a user joins a team.
pub trait ContactsEnqueuer: Clone + Send + Sync + 'static {
    /// Error type returned by enqueue operations.
    type Err: std::fmt::Display + std::fmt::Debug + Send;

    /// Enqueues owned pairs of users that should be connected.
    fn enqueue_contact_connections(
        &self,
        connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// No-op contact enqueuer for callers that do not need contact synchronization.
#[derive(Clone, Debug)]
pub struct NoOpContactsEnqueuer;

impl ContactsEnqueuer for NoOpContactsEnqueuer {
    type Err = Infallible;

    async fn enqueue_contact_connections(
        &self,
        _connections: Vec<(MacroUserIdStr<'static>, MacroUserIdStr<'static>)>,
    ) -> Result<(), Self::Err> {
        Ok(())
    }
}
