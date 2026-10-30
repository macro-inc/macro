//! Adding guests to an Outlook meeting the mailbox organizes.
use super::{OutlookApiClientRepository, attendee_body, unsupported};
use crate::domain::models::AccessToken;
use calendar_events::domain::{models::*, ports::*};
use serde_json::{Value, json};
use std::collections::HashSet;

impl OutlookApiClientRepository {
    /// Add guests to the meeting `id`, or to one of its occurrences, and
    /// refresh the series.
    ///
    /// The mailbox is the inbox the addressed copy syncs through. Graph has no
    /// attendee-side write, so only the organizer's copy can take new guests;
    /// anyone else is refused with a permanent error.
    pub(super) async fn add_calendar_guests(
        &self,
        token: &AccessToken,
        target: &ProviderCalendarTarget,
        id: &str,
        guests: &[CalendarAttendeeInput],
        scope: &CalendarUpdateScope,
    ) -> Result<ProviderInviteOutcome, CalendarProviderError> {
        let Some(master) = self.calendar_event(token, target, id).await? else {
            return Ok(ProviderInviteOutcome::Gone);
        };
        if master["isOrganizer"].as_bool() != Some(true) {
            return Err(unsupported(
                "Outlook lets only the organizer add guests to a meeting",
            ));
        }
        let event = match scope {
            CalendarUpdateScope::All => Some(master),
            CalendarUpdateScope::ThisEvent { recurrence_id } => {
                self.instance_at(token, target, &master, recurrence_id)
                    .await?
            }
        };
        if let Some(event) = &event
            && let Some(body) = attendees_body(event, guests)
        {
            self.patch_calendar_event(token, event, &body).await?;
        }
        Ok(match self.calendar_refresh(token, target, id).await? {
            Some(echo) if event.is_some() => ProviderInviteOutcome::Applied(Box::new(echo)),
            Some(echo) => ProviderInviteOutcome::OccurrenceGone(Box::new(echo)),
            None => ProviderInviteOutcome::Gone,
        })
    }
}

/// Body adding guests to an Outlook event while keeping everyone already on
/// it, or `None` when every guest already is.
///
/// Microsoft Graph has no partial attendee write: `attendees` replaces the
/// whole collection. So the patch carries every attendee Graph returned,
/// unchanged so their answers survive, then the new guests. A patch that
/// holds only `attendees` sends the meeting request to the changed
/// attendees alone, so only the new guests hear about it.
pub(super) fn attendees_body(current: &Value, guests: &[CalendarAttendeeInput]) -> Option<Value> {
    let mut attendees = current["attendees"].as_array().cloned().unwrap_or_default();
    let mut listed: HashSet<String> = attendees
        .iter()
        .chain([&current["organizer"]])
        .filter_map(|attendee| attendee["emailAddress"]["address"].as_str())
        .map(str::to_ascii_lowercase)
        .collect();
    let additions: Vec<CalendarAttendeeInput> = guests
        .iter()
        .filter(|guest| listed.insert(guest.email.trim().to_ascii_lowercase()))
        .cloned()
        .collect();
    if additions.is_empty() {
        return None;
    }
    if let Value::Array(new) = attendee_body(&additions) {
        attendees.extend(new);
    }
    Some(json!({ "attendees": attendees }))
}
