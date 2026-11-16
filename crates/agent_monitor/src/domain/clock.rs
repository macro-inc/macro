//! Where the store and the demo feed get the time, so tests can fix it.

use chrono::Utc;

use crate::domain::model::Timestamp;

/// A source of the current time.
pub trait Clock: Send + Sync + 'static {
    /// Now.
    fn now(&self) -> Timestamp;
}

/// The system clock.
#[derive(Clone, Copy, Debug, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> Timestamp {
        Utc::now()
    }
}
