//! Records the levels of tracing events emitted on the current thread.

use std::cell::RefCell;
use std::sync::Once;

use tracing::{Event, Level, Subscriber};
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::{Layer, Registry};

thread_local! {
    static CAPTURED_LEVELS: RefCell<Option<Vec<Level>>> = const { RefCell::new(None) };
}

/// Records event levels on threads with an active [`LevelCapture`].
///
/// It is installed as the process-wide default because a thread-scoped
/// default races with other test threads: a callsite they register first can
/// cache "never" and drop this thread's events.
struct CapturedLevelsLayer;

impl<S: Subscriber> Layer<S> for CapturedLevelsLayer {
    fn on_event(&self, event: &Event<'_>, _: Context<'_, S>) {
        CAPTURED_LEVELS.with_borrow_mut(|levels| {
            if let Some(levels) = levels {
                levels.push(*event.metadata().level());
            }
        });
    }
}

/// Records the levels of events logged on this thread until dropped.
pub(crate) struct LevelCapture;

impl LevelCapture {
    pub(crate) fn start() -> Self {
        static INSTALL: Once = Once::new();
        INSTALL.call_once(|| {
            tracing::subscriber::set_global_default(Registry::default().with(CapturedLevelsLayer))
                .expect("no other test installs a global subscriber");
        });
        CAPTURED_LEVELS.set(Some(Vec::new()));
        Self
    }

    pub(crate) fn most_severe(&self) -> Option<Level> {
        // `tracing` orders levels by verbosity, so the most severe is the minimum.
        CAPTURED_LEVELS.with_borrow(|levels| levels.iter().flatten().min().copied())
    }
}

impl Drop for LevelCapture {
    fn drop(&mut self) {
        CAPTURED_LEVELS.set(None);
    }
}
