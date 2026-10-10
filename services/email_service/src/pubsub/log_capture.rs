//! Records the levels of tracing events emitted on the current thread.

use std::sync::{Arc, Mutex};

use tracing::subscriber::DefaultGuard;
use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::{Layer, Registry};

#[derive(Clone, Default)]
pub(crate) struct LevelLog(Arc<Mutex<Vec<Level>>>);

impl LevelLog {
    /// Records events on the current thread until the guard is dropped.
    pub(crate) fn capture() -> (Self, DefaultGuard) {
        let log = Self::default();
        let guard = tracing::subscriber::set_default(Registry::default().with(log.clone()));
        (log, guard)
    }

    pub(crate) fn most_severe(&self) -> Option<Level> {
        // `tracing` orders levels by verbosity, so the most severe is the minimum.
        self.0.lock().unwrap().iter().min().copied()
    }
}

impl<S: Subscriber> Layer<S> for LevelLog {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        self.0.lock().unwrap().push(*event.metadata().level());
    }
}
