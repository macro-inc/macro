//! The system clock.

use chrono::{DateTime, Utc};

use crate::domain::ports::Clock;

/// [`Clock`] over the system time.
#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
