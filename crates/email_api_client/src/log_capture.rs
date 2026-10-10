use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use tracing::Level;
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};

/// Records the level of every event emitted while installed as the thread's default subscriber.
#[derive(Clone, Default)]
pub(crate) struct EventLevels {
    levels: Arc<Mutex<Vec<Level>>>,
    next_span_id: Arc<AtomicU64>,
}

impl EventLevels {
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
