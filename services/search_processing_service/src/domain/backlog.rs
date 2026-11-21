//! How far behind the live consumer is, per lane, as one task sees it: the
//! signal the service's autoscaling reads.

use std::{future::Future, time::Duration};

/// The age of the oldest unprocessed record on the partitions this task owns,
/// per lane: zero when caught up, `None` for a lane where it owns no
/// partition, so it does not report that lane caught up for the task that
/// does own it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaneBacklog {
    /// Every topic but email.
    pub live: Option<Duration>,
    /// The email topic, whose partitions carry mailbox imports beside live
    /// mail.
    pub email: Option<Duration>,
}

/// Where each task reports its [`LaneBacklog`].
pub trait BacklogSink: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;

    fn publish(&self, backlog: LaneBacklog) -> impl Future<Output = Result<(), Self::Err>> + Send;
}
