//! Whether a host's calendars are current enough to offer their free time.
use calendar_events::domain::models::{
    CalendarFreshness, CalendarSyncFailure, CalendarSyncHealth, VisibleCalendar,
};
use chrono::{DateTime, Duration, Utc};
use uuid::Uuid;

/// How long after a calendar's last successful sync booking keeps offering
/// time from its stored events while its sync fails transiently. Measured in
/// production in November 2026: a healthy Google calendar's last sync is at
/// most about 6 minutes old and an ordinary Google failure clears within
/// 20; an Outlook calendar's is about 28 minutes old at the 99th percentile
/// and an ordinary Graph blip clears within 15. Past that, a provider outage
/// would serve hours-old events.
pub(super) const STALE_AVAILABILITY_WINDOW: Duration = Duration::minutes(45);

/// Why a host's calendars cannot back availability.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Refusal {
    /// A connected inbox has not listed its calendars yet.
    InboxNotListed,
    /// A calendar that counts has not finished its first sync.
    NotSynced,
    /// A calendar that counts has failed to sync for longer than the window.
    Stale,
    /// A calendar that counts failed for a reason a retry will not fix.
    Permanent,
    /// A calendar that counts lost its grant.
    ReauthRequired,
    /// No primary calendar the host can write is left to take the booking.
    NoCreationCalendar,
}

impl Refusal {
    /// The reason as recorded on spans and logs.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::InboxNotListed => "inbox_not_listed",
            Self::NotSynced => "not_synced",
            Self::Stale => "stale",
            Self::Permanent => "permanent",
            Self::ReauthRequired => "reauth_required",
            Self::NoCreationCalendar => "no_creation_calendar",
        }
    }
}

/// How current the calendars behind an offered availability are.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Served {
    /// Every calendar that counts synced normally.
    Current,
    /// At least one is failing transiently and still inside the window.
    WithinWindow,
}

impl Served {
    /// The outcome as recorded on spans.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Current => "current",
            Self::WithinWindow => "within_window",
        }
    }
}

/// How booking may use one calendar's stored events.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Use {
    Current,
    /// Failing transiently, last synced `stale_for` ago, inside the window.
    WithinWindow {
        stale_for: Duration,
    },
    Refused(Refusal),
}

fn calendar_use(freshness: Option<&CalendarFreshness>, now: DateTime<Utc>) -> Use {
    // A calendar listed between the two reads has no health yet.
    let Some(freshness) = freshness else {
        return Use::Refused(Refusal::NotSynced);
    };
    match (freshness.failure, freshness.refresh_due_at) {
        (Some(CalendarSyncFailure::ReauthRequired), _) => Use::Refused(Refusal::ReauthRequired),
        (Some(CalendarSyncFailure::Permanent), _) => Use::Refused(Refusal::Permanent),
        (_, None) => Use::Refused(Refusal::NotSynced),
        (None, Some(_)) => Use::Current,
        (Some(CalendarSyncFailure::Transient), Some(due)) => {
            let stale_for = (now - due).max(Duration::zero());
            if stale_for <= STALE_AVAILABILITY_WINDOW {
                Use::WithinWindow { stale_for }
            } else {
                Use::Refused(Refusal::Stale)
            }
        }
    }
}

/// A host's calendars with how current each one is.
pub(super) struct HostCalendars<'a> {
    pub calendars: &'a [VisibleCalendar],
    pub health: &'a CalendarSyncHealth,
}

impl HostCalendars<'_> {
    fn freshness(&self, id: Uuid) -> Option<&CalendarFreshness> {
        self.health.calendars.iter().find(|c| c.calendar_id == id)
    }

    /// Whether `calendar` can take a booking's event: a primary calendar the
    /// host can write whose grant still works. A transient sync failure does
    /// not stop a provider write, and one that fails is retried by recovery.
    pub fn can_take_bookings(&self, calendar: &VisibleCalendar) -> bool {
        let failure = self.freshness(calendar.id).and_then(|c| c.failure);
        calendar.is_primary
            && calendar.is_writable
            && !matches!(
                failure,
                Some(CalendarSyncFailure::Permanent | CalendarSyncFailure::ReauthRequired)
            )
    }

    /// Check that every calendar counting toward the host's busy time is
    /// current enough to offer their free time, logging each one that is
    /// not. A calendar with Busy off never changes their availability, so
    /// its sync state never matters here.
    pub fn check_availability(&self, now: DateTime<Utc>) -> Result<Served, Refusal> {
        let mut served = Served::Current;
        let mut refusal = None;
        for email_link_id in &self.health.unlisted_inboxes {
            tracing::warn!(
                %email_link_id,
                reason = Refusal::InboxNotListed.as_str(),
                "refusing booking availability: a calendar that counts is not current"
            );
            refusal = Some(Refusal::InboxNotListed);
        }
        for calendar in self
            .calendars
            .iter()
            .filter(|c| c.contributes_to_availability)
        {
            match calendar_use(self.freshness(calendar.id), now) {
                Use::Current => {}
                Use::WithinWindow { stale_for } => {
                    tracing::info!(
                        calendar_id = %calendar.id,
                        email_link_id = %calendar.email_link_id,
                        stale_seconds = stale_for.num_seconds(),
                        "offering booking availability from a calendar whose sync is failing"
                    );
                    served = Served::WithinWindow;
                }
                Use::Refused(reason) => {
                    tracing::warn!(
                        calendar_id = %calendar.id,
                        email_link_id = %calendar.email_link_id,
                        reason = reason.as_str(),
                        "refusing booking availability: a calendar that counts is not current"
                    );
                    refusal = Some(reason);
                }
            }
        }
        if let Some(refusal) = refusal {
            return Err(refusal);
        }
        if !self.calendars.iter().any(|c| self.can_take_bookings(c)) {
            tracing::warn!(
                reason = Refusal::NoCreationCalendar.as_str(),
                "refusing booking availability: no calendar can take the booking"
            );
            return Err(Refusal::NoCreationCalendar);
        }
        Ok(served)
    }
}
