//! Tokio task-spawning adapters.

use tokio::task::JoinHandle;
use tokio_util::task::TaskTracker;

use crate::domain::ports::Spawner;

/// A [`Spawner`] that uses the current Tokio runtime without tracking tasks.
#[derive(Debug, Clone, Copy, Default)]
pub struct GlobalSpawner;

impl Spawner for GlobalSpawner {
    fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        tokio::spawn(future)
    }
}

impl Spawner for TaskTracker {
    fn spawn<F>(&self, future: F) -> JoinHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        TaskTracker::spawn(self, future)
    }
}
