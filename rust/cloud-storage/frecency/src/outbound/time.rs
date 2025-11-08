//! this module provides an impl of [TimeGetter] suitable for most use cases

use crate::domain::ports::TimeGetter;
use chrono::Utc;

/// The default implementation of time
pub struct DefaultTime;

impl TimeGetter for DefaultTime {
    fn now(&self) -> chrono::DateTime<chrono::Utc> {
        Utc::now()
    }
}
