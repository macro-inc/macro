//! Read projection for the single, private Reminders collection.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use super::{
    email_followup::EmailFollowup,
    models::{InvalidCursor, Reminder, ReminderCursor, ReminderReference},
};

/// A native reminder row with its source and workflow capabilities resolved in bulk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ReminderCollectionRow {
    /// The caller's private reminder.
    pub reminder: Reminder,
    /// Document display metadata, if applicable.
    pub reference: Option<ReminderReference>,
    /// Present only for an email-follow-up mirror, never inferred from its target type.
    pub email_followup: Option<EmailFollowup>,
}

/// Stable position within the collection's actionable-first ordering.
#[derive(Debug, Clone, Copy)]
pub struct CollectionCursor {
    /// Snapshot clock keeps priority stable while paging.
    pub as_of: DateTime<Utc>,
    /// Actionable rows precede completed/paused history.
    pub history: bool,
    /// Ascending schedule and stable identity tie breakers within the section.
    pub position: ReminderCursor,
}

impl CollectionCursor {
    /// URL-safe cursor containing no user data.
    pub fn encode(self) -> String {
        format!(
            "{}.{}.{}",
            self.as_of.timestamp_micros(),
            u8::from(self.history),
            self.position.encode()
        )
    }

    /// Reject malformed positions rather than silently restarting pagination.
    pub fn decode(value: &str) -> Result<Self, InvalidCursor> {
        let mut parts = value.splitn(3, '.');
        let as_of = parts
            .next()
            .and_then(|v| v.parse().ok())
            .and_then(DateTime::from_timestamp_micros)
            .ok_or(InvalidCursor)?;
        let history = match parts.next() {
            Some("0") => false,
            Some("1") => true,
            _ => return Err(InvalidCursor),
        };
        let position = ReminderCursor::decode(parts.next().ok_or(InvalidCursor)?)?;
        Ok(Self {
            as_of,
            history,
            position,
        })
    }
}

/// Filters apply before pagination; absence includes both completion states.
#[derive(Debug, Clone, Default)]
pub struct CollectionQuery {
    /// Optional explicit completion filter.
    pub completed: Option<bool>,
    /// Position returned by the preceding page.
    pub cursor: Option<CollectionCursor>,
    /// Requested page size, bounded by the domain service.
    pub limit: Option<u32>,
}

/// One continuous collection, including completed recurring reminders that still fire.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ReminderCollectionPage {
    /// Rows in server order.
    pub items: Vec<ReminderCollectionRow>,
    /// Absent only on the final page.
    pub next_cursor: Option<String>,
}

/// Done recurring reminders remain actionable while their next schedule is enabled.
pub fn is_history(reminder: &Reminder, now: DateTime<Utc>) -> bool {
    !((reminder.completed_at.is_none() && reminder.next_run_at <= now)
        || (reminder.enabled
            && (reminder.completed_at.is_none()
                || matches!(
                    reminder.schedule,
                    super::models::ReminderSchedule::Recurring { .. }
                ))))
}
