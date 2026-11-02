//! Add an event someone shared by email to the viewer's own calendar.
use super::{
    invitation_resolution::InvitationSnapshotRepository,
    models::calendar_invitation::{CalendarInvitation, InvitationDateTime, InvitationMethod},
};
use calendar_events::domain::{
    ics::EventSnapshot,
    invitations::MAX_INVITATION_BATCH,
    models::{CalendarEvent, EventTime},
    ports::{CalendarMutationError, CalendarSnapshotImporter},
};
use chrono::{DateTime, NaiveDate, Utc};
use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use uuid::Uuid;

/// Add a shared event saved from one of an authorized thread's messages to
/// one of the viewer's Google calendars, the way Add to calendar adds a
/// channel-shared event: a snapshot under the meeting's UID that notifies no
/// one. Only a published event file (`METHOD:PUBLISH`, what Forward by email
/// attaches) is added this way; an invitation is answered from the calendar
/// it reached. Caller-supplied event content is never used.
#[tracing::instrument(
    name = "email.add_shared_event_to_calendar",
    skip(calendar, snapshots, receipt, invitation_id),
    fields(thread_id = %receipt.entity().entity_id, %message_id),
    err
)]
pub async fn add_to_calendar<C: CalendarSnapshotImporter, S: InvitationSnapshotRepository>(
    calendar: &C,
    snapshots: &S,
    receipt: EntityAccessReceipt<ViewAccessLevel>,
    message_id: Uuid,
    invitation_id: &str,
    calendar_id: Option<Uuid>,
) -> Result<CalendarEvent, CalendarMutationError> {
    let viewer = receipt
        .get_authenticated_user()
        .map_err(|_| CalendarMutationError::NotFound)?
        .to_string();
    let thread_id = Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| CalendarMutationError::NotFound)?;
    let saved = snapshots
        .thread_invitations(thread_id, MAX_INVITATION_BATCH as i64)
        .await
        .map_err(|error| CalendarMutationError::Retryable(format!("{error:?}")))?
        .into_iter()
        .find(|saved| saved.message_id == message_id && saved.invitation.id == invitation_id)
        .ok_or(CalendarMutationError::NotFound)?;
    let snapshot = event_snapshot(&saved.invitation)
        .map_err(|reason| CalendarMutationError::InvalidInput(reason.to_string()))?;
    calendar
        .import_snapshot(&viewer, snapshot, calendar_id)
        .await
}

/// The meeting a saved shared event describes, or why it cannot be added.
pub(crate) fn event_snapshot(invite: &CalendarInvitation) -> Result<EventSnapshot, &'static str> {
    if invite.method != InvitationMethod::Publish {
        return Err("only a shared event can be added; answer an invitation from your calendar");
    }
    if invite
        .status
        .as_deref()
        .is_some_and(|status| status.eq_ignore_ascii_case("CANCELLED"))
    {
        return Err("the event was cancelled");
    }
    if invite.recurrence_id_raw.is_some() {
        return Err("a single occurrence of a series cannot be added on its own");
    }
    let recurrence_lines = invite
        .recurrence
        .clone()
        .ok_or("this event was saved before Macro recorded whether it repeats")?;
    let time = event_time(invite.start.as_ref(), invite.end.as_ref())
        .filter(EventTime::is_valid)
        .ok_or("the event's time could not be read")?;
    Ok(EventSnapshot {
        ical_uid: invite.uid.clone(),
        sequence: invite.sequence,
        title: invite.title.clone().unwrap_or_default(),
        description: invite.description.clone(),
        location: invite.location.clone(),
        time,
        recurrence_lines,
        organizer_email: invite
            .organizer
            .as_ref()
            .map(|organizer| organizer.email.clone()),
        organizer_name: invite
            .organizer
            .as_ref()
            .and_then(|organizer| organizer.name.clone()),
    })
}

/// A date start without an end lasts one day, and a timed start without one
/// is a point, as RFC 5545 reads a `VEVENT` with no `DTEND` or `DURATION`.
fn event_time(
    start: Option<&InvitationDateTime>,
    end: Option<&InvitationDateTime>,
) -> Option<EventTime> {
    match (start?, end) {
        (InvitationDateTime::Date { value }, None) => {
            let start_date = date(value)?;
            Some(EventTime::AllDay {
                start_date,
                end_date: start_date.succ_opt()?,
            })
        }
        (InvitationDateTime::Date { value }, Some(InvitationDateTime::Date { value: end })) => {
            Some(EventTime::AllDay {
                start_date: date(value)?,
                end_date: date(end)?,
            })
        }
        (InvitationDateTime::Zoned { value, time_zone }, end) => {
            let starts_at = instant(value)?;
            let ends_at = match end {
                None => starts_at,
                Some(InvitationDateTime::Zoned { value, .. }) => instant(value)?,
                Some(_) => return None,
            };
            Some(EventTime::Timed {
                starts_at,
                ends_at,
                time_zone: Some(time_zone.clone()),
            })
        }
        _ => None,
    }
}

fn date(value: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()
}

fn instant(value: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .ok()
        .map(|instant| instant.with_timezone(&Utc))
}

#[cfg(test)]
mod test;
