use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use tracing::span::{Attributes, Id, Record};
use tracing::subscriber::{DefaultGuard, NoSubscriber};
use tracing::{Dispatch, Event, Level, Metadata, Subscriber};

/// Records the level of every event emitted on a thread while [`EventLevels::capture`] is active.
#[derive(Clone, Default)]
pub(crate) struct EventLevels {
    levels: Arc<Mutex<Vec<Level>>>,
    next_span_id: Arc<AtomicU64>,
}

impl EventLevels {
    /// Records events emitted on the current thread until the returned guard is dropped.
    ///
    /// The recorder is a thread default, not the global one, so it never claims the
    /// process-wide subscriber that other tests may install.
    pub(crate) fn capture(&self) -> DefaultGuard {
        // While a single dispatcher is registered, tracing-core caches a new callsite's
        // interest from the registering thread's default alone, so a callsite first hit
        // by another test thread would cache "never" and drop this thread's events. A
        // second, process-lifetime dispatcher makes it combine every dispatcher's interest.
        static SECOND_DISPATCHER: OnceLock<Dispatch> = OnceLock::new();
        SECOND_DISPATCHER.get_or_init(|| Dispatch::new(NoSubscriber::default()));
        tracing::subscriber::set_default(self.clone())
    }

    pub(crate) fn count(&self, level: Level) -> usize {
        self.levels
            .lock()
            .unwrap()
            .iter()
            .filter(|event_level| **event_level == level)
            .count()
    }
}

impl Subscriber for EventLevels {
    fn enabled(&self, _metadata: &Metadata<'_>) -> bool {
        true
    }

    fn new_span(&self, _attrs: &Attributes<'_>) -> Id {
        Id::from_u64(self.next_span_id.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}

    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}

    fn event(&self, event: &Event<'_>) {
        self.levels.lock().unwrap().push(*event.metadata().level());
    }

    fn enter(&self, _span: &Id) {}

    fn exit(&self, _span: &Id) {}
}
