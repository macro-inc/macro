//! Calendar event models for Soup responses.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Timed or all-day calendar event span.
///
/// Fields are camelCased per variant rather than via `rename_all_fields`,
/// which utoipa ignores — the generated OpenAPI schema would otherwise
/// claim snake_case fields the wire never carries.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", tag = "kind")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub enum SoupCalendarEventTime {
    /// Absolute timed event.
    #[serde(rename_all = "camelCase")]
    Timed {
        /// Inclusive start.
        starts_at: DateTime<Utc>,
        /// Exclusive end.
        ends_at: DateTime<Utc>,
        /// Original IANA time zone.
        time_zone: Option<String>,
    },
    /// All-day event with an exclusive end date.
    #[serde(rename_all = "camelCase")]
    AllDay {
        /// Inclusive start date.
        start_date: NaiveDate,
        /// Exclusive end date.
        end_date: NaiveDate,
    },
}

/// A canonical calendar event entity in Soup.
#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupCalendarEvent<T = ()> {
    /// Entity identifier.
    pub id: Uuid,
    /// Owning Macro user.
    pub owner_id: String,
    /// RFC 5545 UID used for source reconciliation.
    pub ical_uid: String,
    /// Display title.
    pub title: String,
    /// Optional description.
    pub description: Option<String>,
    /// Optional location label.
    pub location: Option<String>,
    /// Canonical status.
    pub status: String,
    /// Canonical visibility.
    pub visibility: String,
    /// Availability transparency.
    pub transparency: String,
    /// Canonical master time.
    pub time: SoupCalendarEventTime,
    /// Organizer email.
    pub organizer_email: Option<String>,
    /// Organizer display name.
    pub organizer_name: Option<String>,
    /// Direct conference join URL.
    pub conference_url: Option<String>,
    /// Which conferencing system backs `conference_url`.
    pub conference_provider: Option<String>,
    /// Whether the selected canonical source is read-only.
    pub is_read_only: bool,
    /// Entity creation timestamp.
    pub created_at: DateTime<Utc>,
    /// Entity update timestamp.
    pub updated_at: DateTime<Utc>,
    /// When this event's most recent reminder notification was delivered.
    #[serde(default)]
    pub last_reminder_fired_at: Option<DateTime<Utc>>,
    /// Additional enriched data such as properties.
    pub extra: T,
}
