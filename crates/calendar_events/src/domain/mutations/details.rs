//! Changing an event's details: the content and time the organizer shares
//! with every guest. Google keeps reminders and availability on each guest's
//! own copy, so any guest may change those.
use super::*;
use crate::domain::capabilities::ViewerCapabilities;
use crate::domain::models::{ConferenceChange, EventDetails};

impl<R, G, T, B, N> CalendarMutationServiceImpl<R, G, T, B, N>
where
    R: CalendarRepository,
    G: CalendarMutationProvider,
    T: CalendarAccessTokenProvider,
    B: MacroEventBroker,
    N: CalendarRefreshNotifier,
{
    /// Refuse a guest the organizer does not let modify the event any change
    /// to its details. Details the patch repeats at their stored value are
    /// dropped first, so a client that resends unchanged fields still saves
    /// the guest's own ones and Google never sees a guest's copy of them.
    /// The owner of a snapshot is such a guest too, although a snapshot
    /// grants no capability at all.
    pub(super) async fn require_detail_rights(
        &self,
        event_id: Uuid,
        scope: &CalendarUpdateScope,
        capabilities: ViewerCapabilities,
        is_snapshot: bool,
        patch: &mut CalendarEventPatch,
    ) -> Result<(), CalendarMutationError> {
        let guest_without_modify = is_snapshot || is_guest_without_modify(capabilities);
        if !guest_without_modify || !changes_details(patch) {
            return Ok(());
        }
        let occurrence_key = match scope {
            CalendarUpdateScope::All => None,
            CalendarUpdateScope::ThisEvent { recurrence_id } => Some(recurrence_id.as_str()),
        };
        let stored = self
            .repository
            .get_event_details(event_id, occurrence_key)
            .await
            .map_err(internal)?
            .ok_or(CalendarMutationError::NotFound)?;
        drop_unchanged_details(patch, &stored);
        if changes_details(patch) {
            return Err(CalendarMutationError::GuestsCannotModify);
        }
        Ok(())
    }
}

/// Whether the actor is a guest the organizer does not let modify the
/// event. Someone neither organizing nor invited, such as a delegate writing
/// to a calendar shared with them, keeps what their calendar access allows.
fn is_guest_without_modify(capabilities: ViewerCapabilities) -> bool {
    capabilities.rsvp && !capabilities.edit_details
}

/// Whether the patch changes a detail. Reminders and availability are each
/// guest's own, and the guest list and guest policy follow their own rules.
fn changes_details(patch: &CalendarEventPatch) -> bool {
    let CalendarEventPatch {
        title,
        description,
        location,
        time,
        attendees: _,
        recurrence_lines,
        visibility,
        transparency: _,
        reminders: _,
        conference,
        out_of_office,
        guest_policy: _,
    } = patch;
    title.is_some()
        || description.is_some()
        || location.is_some()
        || time.is_some()
        || recurrence_lines.is_some()
        || visibility.is_some()
        || conference.is_some()
        || out_of_office.is_some()
}

/// Clear every detail the patch sets to its stored value. A time counts as
/// unchanged when it covers the same span, whatever zone the client named.
fn drop_unchanged_details(patch: &mut CalendarEventPatch, stored: &EventDetails) {
    if patch.title.as_deref() == Some(stored.title.as_str()) {
        patch.title = None;
    }
    // An empty string clears the description or location, which reads back
    // as none.
    if patch.description.as_deref() == Some(stored.description.as_deref().unwrap_or("")) {
        patch.description = None;
    }
    if patch.location.as_deref() == Some(stored.location.as_deref().unwrap_or("")) {
        patch.location = None;
    }
    if patch
        .time
        .as_ref()
        .zip(stored.time.as_ref())
        .is_some_and(|(time, stored)| same_span(time, stored))
    {
        patch.time = None;
    }
    if patch.recurrence_lines.as_ref() == Some(&stored.recurrence_lines) {
        patch.recurrence_lines = None;
    }
    if patch.visibility == Some(stored.visibility) {
        patch.visibility = None;
    }
    if patch.conference == Some(ConferenceChange::Removed) && !stored.has_conference {
        patch.conference = None;
    }
}

fn same_span(time: &EventTime, stored: &EventTime) -> bool {
    match (time, stored) {
        (
            EventTime::Timed {
                starts_at, ends_at, ..
            },
            EventTime::Timed {
                starts_at: stored_starts_at,
                ends_at: stored_ends_at,
                ..
            },
        ) => starts_at == stored_starts_at && ends_at == stored_ends_at,
        (EventTime::AllDay { .. }, EventTime::AllDay { .. }) => time == stored,
        _ => false,
    }
}
