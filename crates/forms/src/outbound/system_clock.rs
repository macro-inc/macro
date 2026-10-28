//! The wall clock.

use chrono::{DateTime, Utc};

use crate::domain::ports::Clock;

/// [`Clock`] reading the system's time.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
