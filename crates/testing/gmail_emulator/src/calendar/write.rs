//! Changing events: `events.insert`, `events.import`, `events.patch` and
//! `events.delete`, and how a change to one copy of a meeting reaches the
//! copies on its organizer's and guests' calendars.

use serde_json::{Value, json};

use super::time::{self, Span, Window};
use super::{
    CANCELLED, Calendar, Fields, attendee_email, attendees, guest_switch, not_found,
    organizer_email, recurrence, text, timestamp,
};
use crate::error::ApiError;
use crate::state::{HeldCopy, State};

/// The id of every user's primary calendar in a request path.
const PRIMARY: &str = "primary";
/// What only Google sets on an event.
const READ_ONLY: [&str; 9] = [
    "kind",
    "etag",
    "created",
    "updated",
    "creator",
    "htmlLink",
    "hangoutLink",
    "recurringEventId",
    "originalStartTime",
];
/// What every copy of a meeting shares. The rest (reminders, availability,
/// visibility, private properties) belongs to one calendar's copy.
const SHARED: [&str; 24] = [
    "kind",
    "id",
    "status",
    "created",
    "summary",
    "description",
    "location",
    "creator",
    "organizer",
    "start",
    "end",
    "endTimeUnspecified",
    "recurrence",
    "recurringEventId",
    "originalStartTime",
    "iCalUID",
    "sequence",
    "attendees",
    "guestsCanModify",
    "guestsCanInviteOthers",
    "guestsCanSeeOtherGuests",
    "eventType",
    "conferenceData",
    "hangoutLink",
];
/// What a guest may change only when the organizer lets guests modify.
const DETAILS: [&str; 8] = [
    "summary",
    "description",
    "location",
    "recurrence",
    "guestsCanModify",
    "guestsCanInviteOthers",
    "guestsCanSeeOtherGuests",
    "conferenceData",
];
const NEEDS_ACTION: &str = "needsAction";
const DECLINED: &str = "declined";

/// Who is changing an event.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Actor {
    /// A client, through the API with the user's token.
    Client,
    /// Whoever publishes the calendar, through the control API: the user in
    /// Google's own interface, or the source of a read-only calendar.
    Publisher,
}

/// How a write was asked for.
#[derive(Clone, Copy, Debug)]
pub(crate) struct WriteOptions {
    pub(crate) actor: Actor,
    /// `conferenceDataVersion=1`: without it Google ignores `conferenceData`.
    pub(crate) conference: bool,
}

impl WriteOptions {
    pub(crate) fn publisher() -> Self {
        Self {
            actor: Actor::Publisher,
            conference: true,
        }
    }
}

fn forbidden_for_guest() -> ApiError {
    ApiError::calendar(
        403,
        "forbiddenForNonOrganizer",
        "The operation can only be performed by the organizer of the event.",
    )
}

/// Applies a JSON merge patch, as Google applies a request body: `null`
/// removes a field, an object merges into the one stored, anything else
/// replaces it.
fn merge_value(target: &mut Fields, name: String, value: Value) {
    match value {
        Value::Null => {
            target.remove(&name);
        }
        Value::Object(patch) => {
            let mut merged = match target.remove(&name) {
                Some(Value::Object(existing)) => existing,
                _ => Fields::new(),
            };
            for (key, value) in patch {
                merge_value(&mut merged, key, value);
            }
            target.insert(name, Value::Object(merged));
        }
        value => {
            target.insert(name, value);
        }
    }
}

/// The conference Google makes for a `createRequest`, or the removal `null`
/// asks for.
fn apply_conference(fields: &mut Fields, conference: Value) {
    let request = conference.get("createRequest");
    let Some(request_id) = request
        .and_then(|request| request.get("requestId"))
        .and_then(Value::as_str)
    else {
        fields.remove("hangoutLink");
        merge_value(fields, "conferenceData".to_string(), conference);
        return;
    };

    let code: String = request_id
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .take(10)
        .collect();
    let link = format!("https://meet.google.com/emu-{}", code.to_lowercase());
    fields.insert("hangoutLink".to_string(), json!(link));
    fields.insert(
        "conferenceData".to_string(),
        json!({
            "createRequest": {
                "requestId": request_id,
                "conferenceSolutionKey": { "type": "hangoutsMeet" },
                "status": { "statusCode": "success" },
            },
            "entryPoints": [{
                "entryPointType": "video",
                "uri": link,
                "label": link.trim_start_matches("https://"),
            }],
            "conferenceSolution": {
                "key": { "type": "hangoutsMeet" },
                "name": "Google Meet",
            },
            "conferenceId": link.rsplit('/').next().unwrap_or_default(),
        }),
    );
}

/// The attendee rows Google stores for the ones a request names.
fn normalized_attendees(
    given: Vec<Value>,
    organizer: Option<&str>,
) -> Result<Vec<Value>, ApiError> {
    let mut rows: Vec<Value> = Vec::new();
    for attendee in given {
        let Value::Object(mut row) = attendee else {
            return Err(ApiError::calendar(400, "invalid", "Invalid attendee."));
        };
        let Some(email) = text(&row, "email").map(str::to_string) else {
            return Err(ApiError::calendar(
                400,
                "required",
                "Missing attendee email.",
            ));
        };
        let listed = rows.iter().any(|row| {
            attendee_email(row).is_some_and(|listed| listed.eq_ignore_ascii_case(&email))
        });
        if listed {
            continue;
        }

        // `self` depends on who reads the event; Google omits false flags.
        row.remove("self");
        row.remove("organizer");
        if row.get("optional") == Some(&json!(false)) {
            row.remove("optional");
        }
        if organizer.is_some_and(|organizer| organizer.eq_ignore_ascii_case(&email)) {
            row.insert("organizer".to_string(), json!(true));
        }
        row.entry("responseStatus").or_insert(json!(NEEDS_ACTION));
        rows.push(Value::Object(row));
    }
    Ok(rows)
}

/// `attendeesOmitted`: the rows given update the attendees already on the
/// event, and may not add one.
fn updated_attendees(existing: &[Value], given: Vec<Value>) -> Result<Vec<Value>, ApiError> {
    let mut rows = existing.to_vec();
    for attendee in given {
        let email = attendee_email(&attendee).unwrap_or_default().to_string();
        let row = rows
            .iter_mut()
            .find(|row| {
                attendee_email(row).is_some_and(|listed| listed.eq_ignore_ascii_case(&email))
            })
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ApiError::calendar(
                    400,
                    "omittedAttendeesSpecified",
                    "Attendees cannot be added while attendeesOmitted is set.",
                )
            })?;
        if let Value::Object(changes) = attendee {
            for (name, value) in changes {
                merge_value(row, name, value);
            }
        }
    }
    Ok(rows)
}

/// Applies a request body to an event.
fn apply_body(
    fields: &mut Fields,
    mut body: Fields,
    options: WriteOptions,
) -> Result<(), ApiError> {
    for name in READ_ONLY {
        body.remove(name);
    }
    let partial = body.remove("attendeesOmitted") == Some(json!(true));
    let conference = body.remove("conferenceData");
    let given = body.remove("attendees");
    for (name, value) in body {
        merge_value(fields, name, value);
    }

    if let Some(conference) = conference
        && options.conference
    {
        match conference {
            Value::Null => {
                fields.remove("conferenceData");
                fields.remove("hangoutLink");
            }
            conference => apply_conference(fields, conference),
        }
    }

    match given {
        None => {}
        Some(Value::Array(given)) => {
            let rows = match partial {
                true => updated_attendees(attendees(fields), given)?,
                false => given,
            };
            let rows = normalized_attendees(rows, organizer_email(fields))?;
            match rows.is_empty() {
                true => fields.remove("attendees"),
                false => fields.insert("attendees".to_string(), Value::Array(rows)),
            };
        }
        Some(Value::Null) => {
            fields.remove("attendees");
        }
        Some(_) => return Err(ApiError::calendar(400, "invalid", "Invalid attendees.")),
    }
    Ok(())
}

/// Checks an event Google would store: its times, and its recurrence.
fn validated(fields: &Fields) -> Result<Span, ApiError> {
    let span = Span::of(fields)?;
    let lines = recurrence(fields);
    if !lines.is_empty() {
        let first = Window {
            from: None,
            until: Some(span.end.instant(chrono_tz::Tz::UTC)),
        };
        time::occurrence_starts(span, &lines, first)?;
    }
    Ok(span)
}

/// Google's ids are base32hex: `0-9` and `a-v`, five characters or more.
fn valid_id(id: &str) -> bool {
    (5..=1024).contains(&id.len())
        && id
            .chars()
            .all(|character| matches!(character, '0'..='9' | 'a'..='v'))
}

fn organizes(calendar: &Calendar, fields: &Fields) -> bool {
    organizer_email(fields).is_none_or(|organizer| organizer == calendar.id)
}

/// The same content, whatever revision stored it.
fn same_content(left: &Fields, right: &Fields) -> bool {
    let content = |fields: &Fields| {
        let mut fields = fields.clone();
        fields.remove("etag");
        fields.remove("updated");
        fields
    };
    content(left) == content(right)
}

/// Refuses what a guest may not change on their copy of someone's event:
/// details and other guests' rows without `guestsCanModify`, new guests
/// without it or `guestsCanInviteOthers`.
fn check_guest_change(before: &Fields, after: &Fields, guest: &str) -> Result<(), ApiError> {
    let may_modify = guest_switch(before, "guestsCanModify", false);
    let may_invite = may_modify || guest_switch(before, "guestsCanInviteOthers", true);
    let rescheduled = match (Span::of(before), Span::of(after)) {
        (Ok(before), Ok(after)) => (before.start, before.end) != (after.start, after.end),
        _ => false,
    };
    let detail_changed = DETAILS
        .iter()
        .any(|name| before.get(*name) != after.get(*name));
    if (rescheduled || detail_changed) && !may_modify {
        return Err(forbidden_for_guest());
    }

    let row = |rows: &[Value], email: &str| {
        rows.iter()
            .find(|row| {
                attendee_email(row).is_some_and(|listed| listed.eq_ignore_ascii_case(email))
            })
            .cloned()
    };
    for attendee in attendees(before) {
        let email = attendee_email(attendee).unwrap_or_default();
        let own = email.eq_ignore_ascii_case(guest);
        let kept = row(attendees(after), email);
        if kept.as_ref() != Some(attendee) && !own && !may_modify {
            return Err(forbidden_for_guest());
        }
        if kept.is_none() && !may_modify {
            return Err(forbidden_for_guest());
        }
    }
    let invites = attendees(after).iter().any(|attendee| {
        row(
            attendees(before),
            attendee_email(attendee).unwrap_or_default(),
        )
        .is_none()
    });
    if invites && !may_invite {
        return Err(forbidden_for_guest());
    }
    Ok(())
}

impl State {
    /// One of a user's calendars. `primary` names their own.
    pub(crate) fn calendar(
        &mut self,
        email: &str,
        calendar_id: &str,
    ) -> Result<&mut Calendar, ApiError> {
        let mailbox = self.mailboxes.get_mut(email).ok_or_else(not_found)?;
        let id = match calendar_id {
            PRIMARY => mailbox.email.as_str(),
            id => id,
        };
        mailbox.calendars.get_mut(id).ok_or_else(not_found)
    }

    fn writable_calendar(
        &mut self,
        email: &str,
        calendar_id: &str,
        actor: Actor,
    ) -> Result<&mut Calendar, ApiError> {
        let calendar = self.calendar(email, calendar_id)?;
        if actor == Actor::Client && !calendar.can_write() {
            return Err(ApiError::calendar(
                403,
                "requiredAccessLevel",
                "You need to have writer access to this calendar.",
            ));
        }
        Ok(calendar)
    }

    /// `events.insert`.
    pub(crate) fn insert_event(
        &mut self,
        email: &str,
        calendar_id: &str,
        body: Fields,
        options: WriteOptions,
    ) -> Result<Fields, ApiError> {
        let now_ms = self.now_ms();
        let generated = format!("emu{}", self.ids.next());
        let calendar = self.writable_calendar(email, calendar_id, options.actor)?;
        let id = match text(&body, "id") {
            None => generated,
            Some(id) if valid_id(id) => id.to_string(),
            Some(_) => {
                return Err(ApiError::calendar(
                    400,
                    "invalid",
                    "Invalid resource id value.",
                ));
            }
        };
        if calendar.events.contains_key(&id) {
            return Err(ApiError::calendar(
                409,
                "duplicate",
                "The requested identifier already exists.",
            ));
        }

        let mut organizer = json!({ "email": calendar.id });
        if !calendar.primary {
            organizer["displayName"] = json!(calendar.summary);
        }
        let mut fields = Fields::new();
        fields.insert("kind".to_string(), json!("calendar#event"));
        fields.insert("id".to_string(), json!(id));
        fields.insert("status".to_string(), json!("confirmed"));
        fields.insert("created".to_string(), json!(timestamp(now_ms)));
        fields.insert("creator".to_string(), json!({ "email": email }));
        fields.insert("organizer".to_string(), organizer.clone());
        fields.insert("iCalUID".to_string(), json!(format!("{id}@google.com")));
        fields.insert("sequence".to_string(), json!(0));
        fields.insert("reminders".to_string(), json!({ "useDefault": true }));
        fields.insert("eventType".to_string(), json!("default"));
        apply_body(&mut fields, body, options)?;
        // An insert names neither its organizer nor its UID.
        fields.insert("organizer".to_string(), organizer);
        fields.insert("iCalUID".to_string(), json!(format!("{id}@google.com")));
        validated(&fields)?;

        let calendar_id = calendar.id.clone();
        let stored = calendar.store(fields, now_ms).fields.clone();
        self.sync_copies(email, &calendar_id, &id, &[]);
        Ok(stored)
    }

    /// `events.import`: a private copy of an event from elsewhere, under its
    /// iCalendar UID. An event the calendar already holds under that UID is
    /// replaced in place.
    pub(crate) fn import_event(
        &mut self,
        email: &str,
        calendar_id: &str,
        body: Fields,
        options: WriteOptions,
    ) -> Result<Fields, ApiError> {
        let now_ms = self.now_ms();
        let generated = format!("emu{}", self.ids.next());
        let calendar = self.writable_calendar(email, calendar_id, options.actor)?;
        let Some(ical_uid) = text(&body, "iCalUID").map(str::to_string) else {
            return Err(ApiError::calendar(400, "required", "Missing iCalUID."));
        };
        let organizer = body
            .get("organizer")
            .cloned()
            .unwrap_or_else(|| json!({ "email": calendar.id }));
        let held = calendar
            .events
            .values()
            .find(|event| text(&event.fields, "iCalUID") == Some(ical_uid.as_str()))
            .and_then(|event| text(&event.fields, "id"))
            .map(str::to_string);
        let id = held.unwrap_or(generated);

        let mut fields = Fields::new();
        fields.insert("kind".to_string(), json!("calendar#event"));
        fields.insert("id".to_string(), json!(id));
        fields.insert("status".to_string(), json!("confirmed"));
        fields.insert("created".to_string(), json!(timestamp(now_ms)));
        fields.insert("creator".to_string(), organizer.clone());
        fields.insert("organizer".to_string(), organizer);
        fields.insert("sequence".to_string(), json!(0));
        fields.insert("reminders".to_string(), json!({ "useDefault": true }));
        fields.insert("eventType".to_string(), json!("default"));
        let mut body = body;
        body.remove("id");
        body.remove("organizer");
        apply_body(&mut fields, body, options)?;
        validated(&fields)?;

        let takes_part = organizes(calendar, &fields)
            || attendees(&fields).iter().any(|attendee| {
                attendee_email(attendee).is_some_and(|listed| {
                    listed.eq_ignore_ascii_case(&calendar.id) || listed.eq_ignore_ascii_case(email)
                })
            });
        if !takes_part {
            return Err(ApiError::calendar(
                403,
                "participantIsNeitherOrganizerNorAttendee",
                "The owner of the calendar must either be the organizer or an attendee of an \
                 event that is imported.",
            ));
        }

        let stored = calendar.store(fields, now_ms);
        stored.imported = true;
        stored.removed_by_guest = false;
        Ok(stored.fields.clone())
    }

    /// `events.patch`. Patching an occurrence of a series by its instance id
    /// makes it an exception.
    pub(crate) fn patch_event(
        &mut self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        mut body: Fields,
        options: WriteOptions,
    ) -> Result<Fields, ApiError> {
        let now_ms = self.now_ms();
        let calendar = self.writable_calendar(email, calendar_id, options.actor)?;
        let before = calendar.event(event_id)?;
        if text(&before, "status") == Some(CANCELLED) {
            return Err(ApiError::calendar(400, "badRequest", "Bad Request"));
        }

        let mut after = before.clone();
        for name in ["id", "iCalUID", "organizer"] {
            body.remove(name);
        }
        apply_body(&mut after, body, options)?;
        let span = validated(&after)?;
        if !organizes(calendar, &before) {
            check_guest_change(&before, &after, email)?;
        }

        let rescheduled = Span::of(&before)
            .is_ok_and(|before| (before.start, before.end) != (span.start, span.end))
            || before.get("recurrence") != after.get("recurrence");
        if rescheduled {
            let sequence = after.get("sequence").and_then(Value::as_u64).unwrap_or(0);
            after.insert("sequence".to_string(), json!(sequence + 1));
        }
        let uninvited: Vec<String> = attendees(&before)
            .iter()
            .filter_map(attendee_email)
            .filter(|email| {
                !attendees(&after).iter().any(|attendee| {
                    attendee_email(attendee).is_some_and(|kept| kept.eq_ignore_ascii_case(email))
                })
            })
            .map(str::to_lowercase)
            .collect();

        let calendar_id = calendar.id.clone();
        let stored = calendar.store(after, now_ms).fields.clone();
        if !stored.contains_key("recurringEventId") {
            calendar.prune_exceptions(event_id);
        }
        self.sync_copies(email, &calendar_id, event_id, &uninvited);
        Ok(stored)
    }

    /// `events.delete`. Deleting an occurrence of a series by its instance
    /// id cancels that occurrence.
    pub(crate) fn delete_event(
        &mut self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        actor: Actor,
    ) -> Result<(), ApiError> {
        let now_ms = self.now_ms();
        let calendar = self.writable_calendar(email, calendar_id, actor)?;
        let mut fields = calendar.event(event_id)?;
        if text(&fields, "status") == Some(CANCELLED) {
            return Err(ApiError::calendar(
                410,
                "deleted",
                "Resource has been deleted",
            ));
        }

        let organizer = organizer_email(&fields).map(str::to_string);
        let by_guest = !organizes(calendar, &fields);
        fields.insert("status".to_string(), json!(CANCELLED));
        let calendar_id = calendar.id.clone();
        let stored = calendar.store(fields, now_ms);
        stored.removed_by_guest = by_guest;
        let is_series = !stored.fields.contains_key("recurringEventId");
        if is_series {
            calendar.prune_exceptions(event_id);
        }
        if !by_guest {
            self.sync_copies(email, &calendar_id, event_id, &[]);
            return Ok(());
        }

        // A guest who removes an event from their calendar declines it.
        let Some((organizer_email, organizer_calendar)) =
            organizer.and_then(|organizer| self.calendar_of_organizer(&organizer))
        else {
            return Ok(());
        };
        self.set_response(
            &organizer_email,
            &organizer_calendar,
            event_id,
            email,
            DECLINED,
        )
        .ok();
        Ok(())
    }

    /// Records an attendee's answer on one copy of an event and carries it
    /// to the others, as when the attendee answers in their own calendar.
    pub(crate) fn set_response(
        &mut self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        attendee: &str,
        response: &str,
    ) -> Result<Fields, ApiError> {
        let now_ms = self.now_ms();
        let calendar = self.calendar(email, calendar_id)?;
        let mut fields = calendar.event(event_id)?;
        let row = fields
            .get_mut("attendees")
            .and_then(Value::as_array_mut)
            .and_then(|rows| {
                rows.iter_mut().find(|row| {
                    attendee_email(row).is_some_and(|listed| listed.eq_ignore_ascii_case(attendee))
                })
            })
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                ApiError::calendar(400, "invalid", &format!("{attendee} is not an attendee."))
            })?;
        row.insert("responseStatus".to_string(), json!(response));

        let calendar_id = calendar.id.clone();
        let stored = calendar.store(fields, now_ms).fields.clone();
        self.sync_copies(email, &calendar_id, event_id, &[]);
        Ok(stored)
    }

    /// The user and calendar an organizer address names, when the emulator
    /// holds that calendar: a user's primary calendar, or a calendar they
    /// can write.
    fn calendar_of_organizer(&self, organizer: &str) -> Option<(String, String)> {
        let organizer = organizer.to_lowercase();
        if self.mailboxes.contains_key(&organizer) {
            return Some((organizer.clone(), organizer));
        }
        self.mailboxes.values().find_map(|mailbox| {
            mailbox
                .calendars
                .get(&organizer)
                .filter(|calendar| calendar.can_write())
                .map(|calendar| (mailbox.email.clone(), calendar.id.clone()))
        })
    }

    /// Stops carrying changes to a meeting's other copies until
    /// [`State::release_copies`]: Google takes some seconds to do it.
    pub(crate) fn hold_copies(&mut self) {
        self.copies_held = true;
    }

    /// Carries every change held since [`State::hold_copies`] to the other
    /// copies, in the order they were made, and stops holding.
    pub(crate) fn release_copies(&mut self) {
        self.copies_held = false;
        for held in std::mem::take(&mut self.held_copies) {
            self.sync_copies(
                &held.email,
                &held.calendar_id,
                &held.event_id,
                &held.uninvited,
            );
        }
    }

    /// Carries a change to one copy of a meeting to its other copies: the
    /// organizer's calendar and the primary calendar of every guest who is a
    /// user here. Guests no longer invited lose their copy.
    ///
    /// Only meetings whose organizer's calendar is in the emulator have
    /// copies; an imported event, or one organized elsewhere, stands alone.
    pub(crate) fn sync_copies(
        &mut self,
        email: &str,
        calendar_id: &str,
        event_id: &str,
        uninvited: &[String],
    ) {
        if self.copies_held {
            self.held_copies.push(HeldCopy {
                email: email.to_string(),
                calendar_id: calendar_id.to_string(),
                event_id: event_id.to_string(),
                uninvited: uninvited.to_vec(),
            });
            return;
        }
        let now_ms = self.now_ms();
        let source = self
            .mailboxes
            .get(email)
            .and_then(|mailbox| mailbox.calendars.get(calendar_id))
            .and_then(|calendar| calendar.events.get(event_id))
            .filter(|event| !event.imported)
            .map(|event| event.fields.clone());
        let Some(source) = source else {
            return;
        };
        let Some(organizer_copy) =
            organizer_email(&source).and_then(|organizer| self.calendar_of_organizer(organizer))
        else {
            return;
        };

        let mut copies = vec![organizer_copy];
        for attendee in attendees(&source) {
            let guest = attendee_email(attendee).unwrap_or_default().to_lowercase();
            let copy = (guest.clone(), guest);
            if self.mailboxes.contains_key(&copy.0) && !copies.contains(&copy) {
                copies.push(copy);
            }
        }
        let holds_copy = |guest: &String| copies.iter().any(|(owner, _)| owner == guest);
        let uninvited: Vec<&String> = uninvited
            .iter()
            .filter(|guest| !holds_copy(guest))
            .collect();
        copies.retain(|(owner, calendar)| owner != email || calendar != calendar_id);

        let is_series = !source.contains_key("recurringEventId");
        for (owner, calendar) in copies {
            let Ok(calendar) = self.calendar(&owner, &calendar) else {
                continue;
            };
            let existing = calendar.events.get(event_id);
            if existing.is_some_and(|event| event.imported || event.removed_by_guest) {
                continue;
            }

            let mut copy = match existing {
                Some(event) => event.fields.clone(),
                None => {
                    Fields::from_iter([("reminders".to_string(), json!({ "useDefault": true }))])
                }
            };
            for name in SHARED {
                match source.get(name) {
                    Some(value) => copy.insert(name.to_string(), value.clone()),
                    None => copy.remove(name),
                };
            }
            if existing.is_some_and(|event| same_content(&event.fields, &copy)) {
                continue;
            }
            calendar.store(copy, now_ms);
            if is_series {
                calendar.prune_exceptions(event_id);
            }
        }

        for guest in uninvited {
            let Ok(calendar) = self.calendar(guest, PRIMARY) else {
                continue;
            };
            let Some(event) = calendar
                .events
                .get(event_id)
                .filter(|event| !event.is_cancelled())
            else {
                continue;
            };
            let mut fields = event.fields.clone();
            fields.insert("status".to_string(), json!(CANCELLED));
            calendar.store(fields, now_ms);
            if is_series {
                calendar.prune_exceptions(event_id);
            }
        }
    }

    /// Gives a user who just arrived their copies of the meetings that
    /// already invite them.
    pub(crate) fn invite_to_existing_meetings(&mut self, guest: &str) {
        let invitations: Vec<(String, String, String)> = self
            .mailboxes
            .values()
            .filter(|mailbox| mailbox.email != guest)
            .flat_map(|mailbox| {
                mailbox.calendars.values().flat_map(|calendar| {
                    calendar
                        .events
                        .values()
                        .filter(|event| organizes(calendar, &event.fields))
                        .filter(|event| {
                            attendees(&event.fields).iter().any(|attendee| {
                                attendee_email(attendee)
                                    .is_some_and(|listed| listed.eq_ignore_ascii_case(guest))
                            })
                        })
                        .filter_map(|event| text(&event.fields, "id"))
                        .map(|id| (mailbox.email.clone(), calendar.id.clone(), id.to_string()))
                })
            })
            .collect();

        for (owner, calendar, event) in invitations {
            self.sync_copies(&owner, &calendar, &event, &[]);
        }
    }
}
