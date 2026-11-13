//! What the wake service stores and answers with.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;

use super::record::{WakeEndStatus, WakePhase, WakeRecord};

/// The longest wake id or system name accepted.
pub const MAX_NAME_LENGTH: usize = 200;

/// The most wakes one page returns.
pub const MAX_PAGE_SIZE: u32 = 100;

/// The page size when the caller names none.
pub const DEFAULT_PAGE_SIZE: u32 = 25;

/// The largest trace accepted, in bytes of JSON.
pub const MAX_TRACE_BYTES: usize = 10 * 1024 * 1024;

/// Where a wake stands: running until its `end` record, then how it ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum WakeStatus {
    /// No `end` record yet.
    Running,
    /// It finished.
    Ok,
    /// It failed.
    Failed,
    /// It ran out of time.
    Timeout,
    /// It was stopped.
    Cancelled,
}

impl From<WakeEndStatus> for WakeStatus {
    fn from(status: WakeEndStatus) -> Self {
        match status {
            WakeEndStatus::Ok => Self::Ok,
            WakeEndStatus::Failed => Self::Failed,
            WakeEndStatus::Timeout => Self::Timeout,
            WakeEndStatus::Cancelled => Self::Cancelled,
        }
    }
}

/// A record that passed validation, with what the table indexes taken out.
#[derive(Debug, Clone, PartialEq)]
pub struct ValidWake {
    /// The record, as received.
    pub record: WakeRecord,
    /// Its phase.
    pub phase: WakePhase,
    /// `running` until the `end` record.
    pub status: WakeStatus,
    /// When the wake began.
    pub started_at: DateTime<Utc>,
}

/// One stored wake: the latest record for its id.
#[derive(Debug, Clone, PartialEq)]
pub struct StoredWake {
    /// The latest record.
    pub record: WakeRecord,
    /// When that record arrived.
    pub received_at: DateTime<Utc>,
    /// When a trace was last uploaded, if one was.
    pub trace_updated_at: Option<DateTime<Utc>>,
}

/// Which wakes to list.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct WakeFilter {
    /// Only wakes in this status.
    pub status: Option<WakeStatus>,
}

/// Where a page of wakes continues from: the last wake of the page before.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct WakeCursor {
    /// The last wake's start.
    pub started_at: DateTime<Utc>,
    /// The last wake's id.
    pub wake_id: String,
}

/// One page of wakes, newest first.
#[derive(Debug, Clone, PartialEq)]
pub struct WakePage {
    /// The wakes.
    pub wakes: Vec<StoredWake>,
    /// Where the next page starts, when there is one.
    pub next: Option<WakeCursor>,
}

/// Who is asking, as authenticated.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Caller {
    /// The authenticated user.
    pub user_id: MacroUserIdStr<'static>,
}

/// What the caller is to the agent, as the repository finds it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AgentRelation {
    /// Whether the agent id names an agent account at all.
    pub is_agent_account: bool,
    /// Whether the caller owns or administers a team the agent is a member of.
    pub caller_administers_agent_team: bool,
}

/// Why a wake request failed.
#[derive(Debug, thiserror::Error)]
pub enum WakeError {
    /// The feature is off for the caller, the agent doesn't exist, or the
    /// caller may not see it. One answer for all three, so nobody learns
    /// which agent accounts exist.
    #[error("not found")]
    NotFound,
    /// The caller may read the agent's wakes but not write them.
    #[error("only the agent itself records its wakes")]
    Forbidden,
    /// The record or trace is not a valid version 1.
    #[error("invalid: {0}")]
    Invalid(String),
    /// The wake id is already used by another system.
    #[error("wake {0} belongs to another system")]
    Conflict(String),
    /// Storage failed.
    #[error("wake storage failed: {0}")]
    Storage(rootcause::Report),
}
