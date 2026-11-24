//! Stopping a routine's run in progress from any instance.
//!
//! A run executes on the instance that claimed it, while the request to stop
//! it can reach any instance. Requests go out through a [`StopRelay`], which
//! tells every instance (this one included) through [`RunStops::heard`]; each
//! run in progress watches for its own id and ends as stopped.

#[cfg(test)]
mod test;

use std::sync::Arc;

use anyhow::Result;
use macro_uuid::Uuid;
use tokio::sync::broadcast;

/// Stop requests in flight at once before a slow watcher misses one. Stops
/// are rare and each watcher drops ids that aren't its own at once.
const STOP_BUFFER: usize = 256;

/// Tells every instance that a run should stop. Object-safe, so the service
/// and executor need not know the transport.
#[async_trait::async_trait]
pub trait StopRelay: Send + Sync + 'static {
    /// Send a stop of `run` (its claim token) to every instance.
    async fn send(&self, run: Uuid) -> Result<()>;
}

/// The stops this instance has heard, for its runs in progress to watch.
#[derive(Clone)]
pub struct RunStops {
    heard: broadcast::Sender<Uuid>,
    /// Without one, a stop reaches only this instance's runs.
    relay: Option<Arc<dyn StopRelay>>,
}

impl Default for RunStops {
    fn default() -> Self {
        Self::new(None)
    }
}

impl RunStops {
    pub fn new(relay: Option<Arc<dyn StopRelay>>) -> Self {
        let (heard, _) = broadcast::channel(STOP_BUFFER);
        Self { heard, relay }
    }

    /// Ask whichever instance runs `run` to stop it.
    pub async fn request(&self, run: Uuid) -> Result<()> {
        match &self.relay {
            Some(relay) => relay.send(run).await,
            None => {
                self.heard(run);
                Ok(())
            }
        }
    }

    /// A stop of `run` arrived from the relay.
    pub fn heard(&self, run: Uuid) {
        // No receiver means no run in progress here to stop.
        let _ = self.heard.send(run);
    }

    /// Start listening before the run's id is known, so a stop sent right
    /// after the claim is not missed.
    pub fn watch(&self) -> StopWatch {
        StopWatch(self.heard.subscribe())
    }
}

/// Stops heard since [`RunStops::watch`].
pub struct StopWatch(broadcast::Receiver<Uuid>);

impl StopWatch {
    /// Resolves once a stop of `run` is heard; never, if none is.
    pub async fn stopped(mut self, run: Uuid) {
        loop {
            match self.0.recv().await {
                Ok(id) if id == run => return,
                // Another run's stop, or stops this watcher fell behind on.
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => {
                    std::future::pending::<()>().await;
                }
            }
        }
    }
}
