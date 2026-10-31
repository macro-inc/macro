//! What says whose calendar an event is on, and what the user is there.
//!
//! Every reader that shows an event to an agent labels it through this module,
//! so a search row and an occurrence of one event cannot disagree.

use std::collections::HashMap;

use uuid::Uuid;

use super::{
    capabilities::{EventAccess, GuestPolicy, ViewerCapabilities},
    models::{ActorInboxes, CalendarAttendee, CalendarEvent, EventStatus, VisibleCalendar},
    ports::CalendarMutationService,
};

/// What the user is on one copy of an event, through the inbox holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EventRole {
    /// The inbox organizes the event, or the event has no guests and is the
    /// user's own.
    Organizer,
    /// The inbox is invited to the event.
    Guest,
}

impl EventRole {
    /// The role of the copy's inbox, read the way clients read it: only the
    /// copy's own inbox row is `is_self`. That row marked organizer counts
    /// only on a copy the user can change, since Microsoft Graph names the
    /// mailbox owner as organizer on every event of a read-only calendar.
    /// `organize` says they may act as organizer, which writing someone
    /// else's calendar grants too, so it counts only on a calendar of their
    /// own schedule with no other organizer listed.
    pub fn of(
        attendees: &[CalendarAttendee],
        is_read_only: bool,
        viewer_can: ViewerCapabilities,
        on_schedule: Option<bool>,
    ) -> Option<Self> {
        let own_row = attendees.iter().find(|attendee| attendee.is_self);
        if own_row.is_some_and(|attendee| attendee.is_organizer) {
            return (!is_read_only).then_some(Self::Organizer);
        }
        let other_organizer = attendees.iter().any(|attendee| attendee.is_organizer);
        if viewer_can.organize && !other_organizer && on_schedule == Some(true) {
            return Some(Self::Organizer);
        }
        own_row.map(|_| Self::Guest)
    }
}

/// The calendars the user can see, to name the calendar and inbox each
/// event copy belongs to.
#[derive(Default)]
pub struct CalendarLabels {
    by_calendar: HashMap<Uuid, VisibleCalendar>,
    inbox_by_link: HashMap<Uuid, String>,
}

impl CalendarLabels {
    /// Load the requester's visible calendars. Labels only describe a result,
    /// so a failure leaves them out rather than failing a call whose change
    /// may already have reached the provider.
    pub async fn load<M: CalendarMutationService>(mutations: &M, requester_id: &str) -> Self {
        let Ok(calendars) = mutations
            .list_visible_calendars(requester_id)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "failed to load calendar names for a tool result");
            })
        else {
            return Self::default();
        };
        Self::from_calendars(calendars)
    }

    /// Labels from calendars the tool already listed.
    pub fn from_calendars(calendars: Vec<VisibleCalendar>) -> Self {
        let inbox_by_link = calendars
            .iter()
            .map(|calendar| (calendar.email_link_id, calendar.email_address.clone()))
            .collect();
        let by_calendar = calendars
            .into_iter()
            .map(|calendar| (calendar.id, calendar))
            .collect();
        Self {
            by_calendar,
            inbox_by_link,
        }
    }

    /// Display name of a calendar the user can see.
    pub fn calendar_name(&self, calendar_id: Option<Uuid>) -> Option<String> {
        calendar_id
            .and_then(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.name.clone())
    }

    /// Whether any of these calendars counts toward the user's busy time,
    /// when one is known. Availability counts each copy of an event, so one
    /// copy on the user's schedule is enough.
    pub fn on_schedule(&self, calendar_ids: impl IntoIterator<Item = Uuid>) -> Option<bool> {
        calendar_ids
            .into_iter()
            .filter_map(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.contributes_to_availability)
            .reduce(|left, right| left || right)
    }

    /// Whether a calendar holding this event is on the user's schedule.
    pub fn event_on_schedule(&self, event: &CalendarEvent) -> Option<bool> {
        let copies = event.sources.iter().map(|copy| copy.calendar_id);
        self.on_schedule(event.calendar_id.into_iter().chain(copies))
    }

    /// The inbox holding a copy: its calendar's inbox, else the inbox whose
    /// grant backs it.
    pub fn inbox(&self, calendar_id: Option<Uuid>, link_id: Option<Uuid>) -> Option<String> {
        calendar_id
            .and_then(|id| self.by_calendar.get(&id))
            .map(|calendar| calendar.email_address.clone())
            .or_else(|| link_id.and_then(|id| self.inbox_by_link.get(&id)).cloned())
    }

    /// The user's role on an event already marked for them.
    pub fn role(&self, event: &CalendarEvent) -> Option<EventRole> {
        EventRole::of(
            &event.attendees,
            event.is_read_only,
            event.viewer_can,
            self.event_on_schedule(event),
        )
    }
}

/// One copy of an event, as much of it as labelling reads.
#[derive(Debug, Clone)]
pub struct EventCopy {
    /// The event.
    pub event_id: Uuid,
    /// The inbox the copy syncs through.
    pub link_id: Uuid,
    /// Event status.
    pub status: EventStatus,
    /// The organizer's email.
    pub organizer_email: Option<String>,
    /// Whether the copy's calendar prohibits editing it.
    pub is_read_only: bool,
    /// Whether the copy is a snapshot of a shared meeting.
    pub is_snapshot: bool,
    /// What the organizer lets guests do.
    pub guest_policy: GuestPolicy,
    /// The stored guest list.
    pub attendees: Vec<CalendarAttendee>,
    /// The calendars holding the copy, the one its event reports first.
    pub calendar_ids: Vec<Uuid>,
}

/// How one event reads for the requester, to say whose calendar it is on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EventLabels {
    /// Display name of the calendar, when it is one the user can see.
    pub calendar_name: Option<String>,
    /// Whether a calendar holding the event is on the user's schedule, when
    /// one is known.
    pub contributes_to_availability: Option<bool>,
    /// The connected inbox syncing the calendar. It stays the user's own
    /// address on a colleague's calendar, so it never says whose it is.
    pub inbox: Option<String>,
    /// What the user is on this copy, if anything.
    pub role: Option<EventRole>,
}

impl EventLabels {
    /// Label a copy for the requester `viewer` describes, the way
    /// [`ActorInboxes::mark_event`] and [`CalendarLabels::role`] read a loaded
    /// event.
    pub fn of(
        mut copy: EventCopy,
        viewer: Option<&ActorInboxes>,
        calendars: &CalendarLabels,
    ) -> Self {
        let viewer_can = viewer.map_or(ViewerCapabilities::NONE, |viewer| {
            viewer.mark_attendees(&mut copy.attendees, copy.link_id);
            ViewerCapabilities::for_copy(
                copy.status,
                EventAccess {
                    is_read_only: copy.is_read_only,
                    organizer_email: copy.organizer_email.as_deref(),
                    attendees: &copy.attendees,
                    guest_policy: copy.guest_policy,
                    is_snapshot: copy.is_snapshot,
                },
                viewer.inbox(copy.link_id),
            )
        });
        let calendar_id = copy.calendar_ids.first().copied();
        let on_schedule = calendars.on_schedule(copy.calendar_ids.iter().copied());
        Self {
            calendar_name: calendars.calendar_name(calendar_id),
            contributes_to_availability: on_schedule,
            inbox: calendars.inbox(calendar_id, None),
            role: EventRole::of(&copy.attendees, copy.is_read_only, viewer_can, on_schedule),
        }
    }
}

#[cfg(test)]
mod test;
