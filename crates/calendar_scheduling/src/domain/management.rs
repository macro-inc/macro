//! Booking management workflows shared by interactive and headless clients.
use super::{models::*, ports::*, service::Service};
use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A host's requested change to a booked meeting.
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "action", rename_all = "camelCase", deny_unknown_fields)]
pub enum BookingChange {
    /// Approve a legacy pending booking and send its calendar invitations.
    Approve,
    /// Cancel a booking and notify its attendees.
    Cancel,
    /// Record or clear attendance after the meeting ends.
    Attendance {
        /// Recorded outcome.
        attendance: BookingAttendance,
    },
    /// Move the existing meeting to an available time; notify attendees.
    Reschedule {
        /// Absolute start chosen from available replacement slots.
        #[serde(rename = "startsAt")]
        starts_at: DateTime<Utc>,
    },
}
impl<R: Repository, C: Calendars, D: Directory> Service<R, C, D> {
    /// Apply a change using the same authorization and lifecycle rules as the UI.
    pub async fn change_booking(
        &self,
        user: &str,
        id: Uuid,
        change: BookingChange,
    ) -> Result<Booking, Error> {
        match change {
            BookingChange::Approve => self.approve(user, id).await,
            BookingChange::Cancel => self.cancel(id, None, Some(user)).await,
            BookingChange::Attendance { attendance } => {
                self.set_attendance(user, id, attendance).await
            }
            BookingChange::Reschedule { starts_at } => {
                let record = self.manage(user, id).await?;
                Ok(self.reschedule(id, record.token, starts_at).await?.booking)
            }
        }
    }
    /// Discover replacement times without exposing the booking's bearer token.
    pub async fn host_replacement_slots(
        &self,
        user: &str,
        id: Uuid,
        date: NaiveDate,
    ) -> Result<Vec<Slot>, Error> {
        let record = self.manage(user, id).await?;
        self.replacement_slots(id, record.token, date).await
    }
}
