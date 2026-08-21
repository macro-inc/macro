//! Asynchronous channel event dispatch backed by Tokio tasks.

use crate::domain::{
    events::ChannelEvent,
    ports::{ChannelEventDispatcher, ChannelEventHandler},
};
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

/// Channel event dispatcher that handles events on tracked tasks.
#[derive(Clone)]
pub struct SpawnedChannelEventDispatcher<H> {
    handler: H,
    tasks: TaskTracker,
}

impl<H> SpawnedChannelEventDispatcher<H> {
    /// Create a dispatcher with an independently owned task tracker.
    pub fn new(handler: H) -> Self {
        Self::with_task_tracker(handler, TaskTracker::new())
    }

    /// Create a dispatcher whose tasks are owned by `tasks` for graceful shutdown.
    pub fn with_task_tracker(handler: H, tasks: TaskTracker) -> Self {
        Self { handler, tasks }
    }
}

impl<H> ChannelEventDispatcher for SpawnedChannelEventDispatcher<H>
where
    H: ChannelEventHandler,
{
    fn dispatch(&self, event: ChannelEvent) {
        let handler = self.handler.clone();
        let span = tracing::info_span!("channel.side_effects");
        self.tasks.spawn(
            async move {
                handler.handle(event).await;
            }
            .instrument(span),
        );
    }
}

#[cfg(test)]
mod test;
