//! Private reminder metadata for original email rows.

pub mod service;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{email_followup::EmailFollowup, models::InvalidCursor};

/// An original thread with its active snooze.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailReminderSummary {
    /// Original email identity, never a mirror reminder identity.
    pub thread_id: Uuid,
    /// Active snooze, including the revision required for edits or removal.
    pub followup: EmailFollowup,
}

/// Stable thread position, independent of the email's activity ordering.
#[derive(Debug, Clone, Copy)]
pub struct EmailReminderCursor {
    /// Fixed clock shared by every page in a collection traversal.
    pub as_of: DateTime<Utc>,
    /// Nearest occurrence at the time this candidate was examined.
    pub next_run_at: DateTime<Utc>,
    /// Identity breaks ties between equal occurrences.
    pub thread_id: Uuid,
}

impl EmailReminderCursor {
    /// Encode without exposing private reminder descriptions.
    pub fn encode(self) -> String {
        format!(
            "{}.{}.{}",
            self.as_of.timestamp_micros(),
            self.next_run_at.timestamp_micros(),
            self.thread_id
        )
    }

    /// Reject invalid cursors instead of restarting a page.
    pub fn decode(value: &str) -> Result<Self, InvalidCursor> {
        let (as_of, remaining) = value.split_once('.').ok_or(InvalidCursor)?;
        let (time, id) = remaining.split_once('.').ok_or(InvalidCursor)?;
        Ok(Self {
            as_of: as_of
                .parse()
                .ok()
                .and_then(DateTime::from_timestamp_micros)
                .ok_or(InvalidCursor)?,
            next_run_at: time
                .parse()
                .ok()
                .and_then(DateTime::from_timestamp_micros)
                .ok_or(InvalidCursor)?,
            thread_id: id.parse().map_err(|_| InvalidCursor)?,
        })
    }
}

/// Email-owned filters and reminder-owned pagination for one collection request.
#[derive(Debug, Clone, Default)]
pub struct EmailReminderQuery {
    /// Email filters evaluated by the owning read service.
    pub filters: email::domain::followup::ReminderThreadFilter,
    /// Opaque cursor also binds the request to its filter scope.
    pub cursor: Option<String>,
    /// Domain clamps this to the supported page size.
    pub limit: Option<u32>,
}

/// Caller identity is reused across authorization and email reads for a page.
pub struct EmailReminderViewer {
    /// Authenticated private reminder owner.
    pub user_id: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// Organization context used to mint email view receipts.
    pub org_id: Option<i64>,
}

/// Candidate progress is retained even if a stored snooze is malformed.
#[derive(Debug)]
pub struct EmailReminderCandidate {
    /// Storage position, including unreadable candidates.
    pub cursor: EmailReminderCursor,
    /// Only successfully decoded, current reminders.
    pub summary: Option<EmailReminderSummary>,
}

/// A page of original-email identities and private reminder metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailReminderPage {
    /// Original threads ordered by their snooze return time.
    pub items: Vec<EmailReminderSummary>,
    /// Progress through all examined candidates, absent at exhaustion.
    pub next_cursor: Option<String>,
}
