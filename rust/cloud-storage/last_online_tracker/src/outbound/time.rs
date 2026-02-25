//! Default implementation of [SystemTime]

use crate::domain::ports::SystemTime;
use chrono::{DateTime, Utc};

/// Default implementation that returns the current UTC time
pub struct DefaultTime;

impl SystemTime for DefaultTime {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}
