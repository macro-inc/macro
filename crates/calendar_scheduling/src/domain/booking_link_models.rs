//! Complete booking-link drafts, independent of transport and persisted identities.
use super::models::*;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// All editable rules for one link. Personal links must use the authenticated user as host.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookingLinkEvent {
    /// Public title.
    pub title: String,
    /// Unique link segment within a profile.
    pub slug: String,
    /// Public description.
    pub description: String,
    /// Meeting duration.
    pub duration_minutes: u16,
    /// Meeting location.
    pub location: String,
    /// Generate a Google Meet conference.
    pub google_meet: bool,
    /// Whether new bookings are accepted.
    pub enabled: bool,
    /// Host assignment policy.
    pub mode: SchedulingMode,
    /// Current Macro user identities selected as hosts.
    pub hosts: Vec<String>,
    /// Protected time before a meeting.
    pub before_minutes: u16,
    /// Protected time after a meeting.
    pub after_minutes: u16,
    /// Minimum notice in minutes.
    pub notice_minutes: u16,
    /// Maximum days ahead.
    pub horizon_days: u16,
    /// Spacing of offered start times.
    pub interval_minutes: u16,
    /// Maximum bookings for this event on one schedule-local day.
    pub daily_limit: Option<u16>,
    /// Hold bookings for host approval.
    pub requires_confirmation: bool,
    /// Additional form fields.
    pub questions: Vec<Question>,
}

/// Availability copied into a dedicated schedule when it changes; other links retain their hours.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookingLinkSchedule {
    /// Display name.
    pub name: String,
    /// IANA time zone.
    #[cfg_attr(feature = "ai_tools", schemars(with = "String"))]
    pub time_zone: chrono_tz::Tz,
    /// Weekly windows.
    pub weekly: Vec<WeeklyDay>,
    /// Date-specific replacements.
    pub overrides: Vec<DateOverride>,
}

/// Complete proposal reviewed and validated before saving.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookingLinkDraft {
    /// Public details, hosts, booking rules and questions.
    pub event: BookingLinkEvent,
    /// Weekly hours, IANA time zone, and date overrides for this link.
    pub schedule: BookingLinkSchedule,
}

/// Saved link with actual identities and revision for subsequent edits.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookingLink {
    /// Owning profile.
    pub profile_id: Uuid,
    /// Stable link identity.
    pub event_type_id: Uuid,
    /// Profile revision to supply when editing.
    pub revision: i64,
    /// Full editable configuration.
    pub draft: BookingLinkDraft,
}

/// Authorized discovery results including reusable availability.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "ai_tools", derive(schemars::JsonSchema))]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BookingLinkListing {
    /// Current team identities that can be used to discover team links.
    pub team_ids: Vec<Uuid>,
    /// Current authenticated host identity for personal drafts.
    pub user_id: String,
    /// Owning profile identity, including unsaved new profiles.
    pub profile_id: Uuid,
    /// Current revision.
    pub revision: i64,
    /// Reusable schedules, even when no links match.
    pub schedules: Vec<Schedule>,
    /// Links whose title, slug or description matches the search, including paused links.
    pub links: Vec<BookingLink>,
}

impl BookingLinkDraft {
    /// Extract a draft without persisted event or schedule identities.
    pub fn from_parts(event: &EventType, schedule: &Schedule) -> Self {
        Self {
            event: BookingLinkEvent {
                title: event.title.clone(),
                slug: event.slug.clone(),
                description: event.description.clone(),
                duration_minutes: event.duration_minutes,
                location: event.location.clone(),
                google_meet: event.google_meet,
                enabled: event.enabled,
                mode: event.mode,
                hosts: event.hosts.clone(),
                before_minutes: event.before_minutes,
                after_minutes: event.after_minutes,
                notice_minutes: event.notice_minutes,
                horizon_days: event.horizon_days,
                interval_minutes: event.interval_minutes,
                daily_limit: event.daily_limit,
                requires_confirmation: event.requires_confirmation,
                questions: event.questions.clone(),
            },
            schedule: BookingLinkSchedule {
                name: schedule.name.clone(),
                time_zone: schedule.time_zone,
                weekly: schedule.weekly.clone(),
                overrides: schedule.overrides.clone(),
            },
        }
    }
    pub(super) fn into_parts(self, event_id: Uuid, schedule_id: Uuid) -> (EventType, Schedule) {
        (
            EventType {
                id: event_id,
                schedule_id,
                title: self.event.title,
                slug: self.event.slug,
                description: self.event.description,
                duration_minutes: self.event.duration_minutes,
                location: self.event.location,
                google_meet: self.event.google_meet,
                enabled: self.event.enabled,
                mode: self.event.mode,
                hosts: self.event.hosts,
                before_minutes: self.event.before_minutes,
                after_minutes: self.event.after_minutes,
                notice_minutes: self.event.notice_minutes,
                horizon_days: self.event.horizon_days,
                interval_minutes: self.event.interval_minutes,
                daily_limit: self.event.daily_limit,
                requires_confirmation: self.event.requires_confirmation,
                questions: self.event.questions,
            },
            Schedule {
                id: schedule_id,
                name: self.schedule.name,
                time_zone: self.schedule.time_zone,
                weekly: self.schedule.weekly,
                overrides: self.schedule.overrides,
            },
        )
    }
}
