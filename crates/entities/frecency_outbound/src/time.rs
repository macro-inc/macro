//! this module provides an impl of [TimeGetter] suitable for most use cases

use chrono::Utc;
use frecency_core::ports::TimeGetter;

/// The default implementation of time
pub struct DefaultTime;

impl TimeGetter for DefaultTime {
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        Utc::now()
    }
}
