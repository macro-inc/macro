//! Actual human RTC connections, separate from room allocation and join credentials.

use std::{future::Future, pin::Pin};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::{meetings::MeetingToken, models::CallError};

/// One provider connection session observed through a signed participant webhook.
#[derive(Clone, Debug)]
pub struct RtcAttendance {
    /// Provider participant session identifier; a reconnect creates a new session.
    pub participant_sid: String,
    /// Provider timestamp for the actual connection.
    pub joined_at: DateTime<Utc>,
    /// Provider departure timestamp, if the observation describes a departure.
    pub left_at: Option<DateTime<Utc>>,
}

/// A meeting capability and the authoritative current booking window.
pub struct MeetingAttendanceRequest {
    /// Exact capability saved in the booking's generated Macro meeting URL.
    pub token: MeetingToken,
    /// Inclusive start of the booking window.
    pub starts_at: DateTime<Utc>,
    /// Exclusive end of the booking window.
    pub ends_at: DateTime<Utc>,
}

/// Human participants observed during one fully tracked, finished booking window.
#[derive(Debug, Default)]
pub struct MeetingAttendance {
    /// Distinct authenticated humans; programmatic clients never qualify.
    pub user_ids: Vec<MacroUserIdStr<'static>>,
    /// At least one anonymous human connected during the window.
    pub guest_present: bool,
}

/// Completion of a bounded meeting-attendance read.
pub type MeetingAttendanceFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Vec<Option<MeetingAttendance>>, CallError>> + Send + 'a>>;
/// Narrow read capability for consumers that already hold the meeting link.
pub trait MeetingAttendanceReader: Send + Sync {
    /// Preserve request order; `None` denotes missing, untracked or still-live evidence.
    fn read<'a>(&'a self, requests: &'a [MeetingAttendanceRequest]) -> MeetingAttendanceFuture<'a>;
}
