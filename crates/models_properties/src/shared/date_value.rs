//! Date property value type shared across all layers.

use chrono::{DateTime, Utc};

/// A date property's value: an instant, and whether its time of day was set.
///
/// Without a time, a task or project date stands for the whole calendar day
/// it was picked on and is held at that day's local midnight, as every date
/// stored before times existed is. With one, it is the exact instant. Stored
/// as `{"type": "Date", "value": <instant>}`, plus `"has_time": true` only
/// when a time was set, so a value without one keeps its old form. Database
/// date cells keep their own convention and never set it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct DateValue {
    at: DateTime<Utc>,
    has_time: bool,
}

impl DateValue {
    /// A date without a time of day.
    pub fn new(at: DateTime<Utc>) -> Self {
        Self {
            at,
            has_time: false,
        }
    }

    /// A date whose time of day was set.
    pub fn with_time(at: DateTime<Utc>) -> Self {
        Self { at, has_time: true }
    }

    /// The stored instant.
    pub fn at(&self) -> DateTime<Utc> {
        self.at
    }

    /// Whether the instant's time of day was set.
    pub fn has_time(&self) -> bool {
        self.has_time
    }
}
