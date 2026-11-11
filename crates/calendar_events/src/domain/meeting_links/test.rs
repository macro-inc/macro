use std::sync::Mutex;

use chrono::{NaiveDate, TimeZone, Utc};

use super::*;
use crate::domain::models::{
    AttendeeResponseStatus, CalendarAttendeeInput, CalendarEventPatch, ConferenceChange,
    EventDetails, EventReminders, EventStatus, EventTransparency, EventType, EventVisibility,
    GuestPolicy, OutOfOfficeProperties, ViewerCapabilities, VisibleCalendar,
};
use crate::domain::ports::{
    CalendarDeletionScope, CalendarRsvpScope, CalendarUpdateScope, UnavailableMeetingLinks,
};

const URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";

fn sample_event() -> CalendarEvent {
    CalendarEvent {
        id: Uuid::from_u128(7),
        owner_id: "macro|owner@example.com".to_string(),
        ical_uid: "uid-1".to_string(),
        calendar_id: Some(Uuid::from_u128(9)),
        sources: Vec::new(),
        title: "Standup".to_string(),
        description: None,
        location: None,
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: timed(),
        recurrence_lines: Vec::new(),
        organizer_email: None,
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: None,
        conference_provider: None,
        sequence: 0,
        is_read_only: false,
        attendees: Vec::new(),
        reminders: EventReminders::default(),
        guest_policy: GuestPolicy::default(),
        is_snapshot: false,
        viewer_can: ViewerCapabilities::NONE,
        created_at: Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
        updated_at: Utc.with_ymd_and_hms(2026, 8, 1, 0, 0, 0).unwrap(),
    }
}

fn timed() -> EventTime {
    EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 8, 20, 18, 0, 0).unwrap(),
        time_zone: Some("America/New_York".to_string()),
    }
}

fn draft() -> CalendarEventDraft {
    CalendarEventDraft {
        idempotency_key: None,
        title: "Design review".to_string(),
        description: None,
        location: None,
        time: timed(),
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        visibility: None,
        transparency: None,
        reminders: None,
        conference: None,
        out_of_office: None,
        guest_policy: None,
    }
}

type RecordedUpdate = (Uuid, Option<Uuid>, CalendarEventPatch, CalendarUpdateScope);

#[derive(Default)]
struct FakeMutations {
    created: Mutex<Vec<CalendarEventDraft>>,
    create_error: Mutex<Option<CalendarMutationError>>,
    details: Mutex<Option<EventDetails>>,
    updated: Mutex<Vec<RecordedUpdate>>,
    update_error: Mutex<Option<CalendarMutationError>>,
}

impl FakeMutations {
    fn failing_with(error: CalendarMutationError) -> Self {
        Self {
            create_error: Mutex::new(Some(error)),
            ..Self::default()
        }
    }
}

impl CalendarMutationService for FakeMutations {
    async fn create_event(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if let Some(error) = self.create_error.lock().unwrap().take() {
            return Err(error);
        }
        self.created.lock().unwrap().push(draft);
        Ok(sample_event())
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, CalendarMutationError> {
        unreachable!("creating with a Macro call lists no calendars")
    }

    async fn update_event(
        &self,
        _requester_id: &str,
        event_id: Uuid,
        calendar_id: Option<Uuid>,
        patch: CalendarEventPatch,
        scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if let Some(error) = self.update_error.lock().unwrap().take() {
            return Err(error);
        }
        self.updated
            .lock()
            .unwrap()
            .push((event_id, calendar_id, patch, scope));
        Ok(sample_event())
    }

    async fn delete_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("creating with a Macro call deletes nothing")
    }

    async fn respond_to_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _response: AttendeeResponseStatus,
        _scope: CalendarRsvpScope,
        _responding_email: Option<String>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("creating with a Macro call answers no invitation")
    }

    async fn invite_guests(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _guests: Vec<CalendarAttendeeInput>,
        _scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("creating with a Macro call invites no one afterwards")
    }

    async fn copy_shared_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("creating with a Macro call copies nothing")
    }

    async fn respond_to_join_request(
        &self,
        _requester_id: &str,
        _request_id: Uuid,
        _accept: bool,
    ) -> Result<crate::domain::join_requests::CalendarJoinRequest, CalendarMutationError> {
        unreachable!("creating with a Macro call answers no join request")
    }

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("creating with a Macro call disconnects nothing")
    }
}

impl CalendarEventDetailsReader for FakeMutations {
    async fn details_for_update(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _scope: &CalendarUpdateScope,
    ) -> Result<EventDetails, CalendarMutationError> {
        self.details
            .lock()
            .unwrap()
            .clone()
            .ok_or(CalendarMutationError::NotFound)
    }
}

#[derive(Default)]
struct FakeMeetingLinks {
    requests: Mutex<Vec<(String, MeetingLinkRequest)>>,
    cancelled: Mutex<Vec<(String, Uuid)>>,
    fail_create: bool,
}

impl MeetingLinkProvider for FakeMeetingLinks {
    async fn create_meeting_link(
        &self,
        requester_id: &str,
        request: MeetingLinkRequest,
    ) -> Result<MeetingLink, MeetingLinkError> {
        if self.fail_create {
            return Err(MeetingLinkError::Failed("call service down".to_string()));
        }
        self.requests
            .lock()
            .unwrap()
            .push((requester_id.to_string(), request));
        Ok(MeetingLink {
            id: Uuid::from_u128(42),
            url: URL.to_string(),
        })
    }

    async fn cancel_meeting_link(
        &self,
        requester_id: &str,
        meeting_id: Uuid,
    ) -> Result<(), MeetingLinkError> {
        self.cancelled
            .lock()
            .unwrap()
            .push((requester_id.to_string(), meeting_id));
        Ok(())
    }
}

#[test]
fn attaching_fills_an_empty_location_and_appends_a_join_paragraph() {
    let (description, location) = attach_macro_call(None, None, URL);
    assert_eq!(
        description,
        format!("<p>Join Macro call: <a href=\"{URL}\">{URL}</a></p>")
    );
    assert_eq!(location, URL);
}

#[test]
fn attaching_keeps_user_text_and_a_physical_location() {
    let (description, location) = attach_macro_call(Some("<p>Agenda</p>"), Some("  Room 4 "), URL);
    assert_eq!(
        description,
        format!("<p>Agenda</p>\n<p>Join Macro call: <a href=\"{URL}\">{URL}</a></p>")
    );
    assert_eq!(location, "Room 4");
}

#[test]
fn a_blank_location_counts_as_absent() {
    let (_, location) = attach_macro_call(None, Some("   "), URL);
    assert_eq!(location, URL);
}

#[test]
fn a_timed_draft_schedules_the_meeting_and_an_all_day_draft_does_not() {
    let timed = MeetingLinkRequest::for_draft(&draft());
    assert_eq!(timed.title, "Design review");
    assert_eq!(
        timed.scheduled_start,
        Some(Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap())
    );
    assert_eq!(
        timed.scheduled_end,
        Some(Utc.with_ymd_and_hms(2026, 8, 20, 18, 0, 0).unwrap())
    );

    let all_day = MeetingLinkRequest::for_draft(&CalendarEventDraft {
        time: EventTime::AllDay {
            start_date: NaiveDate::from_ymd_opt(2026, 8, 20).unwrap(),
            end_date: NaiveDate::from_ymd_opt(2026, 8, 21).unwrap(),
        },
        ..draft()
    });
    assert_eq!(all_day.scheduled_start, None);
    assert_eq!(all_day.scheduled_end, None);
}

#[tokio::test]
async fn the_meeting_is_minted_as_the_requester_and_written_into_the_draft() {
    let mutations = FakeMutations::default();
    let links = FakeMeetingLinks::default();
    let calendar_id = Uuid::from_u128(3);

    let created = create_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        None,
        Some(calendar_id),
        CalendarEventDraft {
            description: Some("<p>Agenda</p>".to_string()),
            ..draft()
        },
    )
    .await
    .unwrap();
    assert_eq!(created.event.id, Uuid::from_u128(7));
    assert_eq!(created.meeting_link.url, URL);

    let requests = links.requests.lock().unwrap();
    let (requester, request) = requests.first().expect("one meeting minted");
    assert_eq!(requester, "macro|owner@example.com");
    assert_eq!(request.title, "Design review");
    assert!(request.scheduled_start.is_some());

    let created = mutations.created.lock().unwrap();
    let written = created.first().expect("one event created");
    assert_eq!(written.location.as_deref(), Some(URL));
    assert_eq!(
        written.description.as_deref(),
        Some(
            format!("<p>Agenda</p>\n<p>Join Macro call: <a href=\"{URL}\">{URL}</a></p>").as_str()
        )
    );
    assert_eq!(written.conference, None);
    assert!(links.cancelled.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_calendar_write_refused_before_the_provider_cancels_the_fresh_meeting() {
    for refused in [
        CalendarMutationError::NoWritableCalendar,
        CalendarMutationError::ReadOnly,
        CalendarMutationError::InvalidInput("bad".to_string()),
        CalendarMutationError::ReauthRequired("expired".to_string()),
        CalendarMutationError::ProviderRejected("nope".to_string()),
    ] {
        let mutations = FakeMutations::failing_with(refused);
        let links = FakeMeetingLinks::default();

        let error = create_event_with_macro_call(
            &mutations,
            &links,
            "macro|owner@example.com",
            None,
            None,
            draft(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, MacroCallEventError::Calendar(_)));
        assert_eq!(
            *links.cancelled.lock().unwrap(),
            vec![("macro|owner@example.com".to_string(), Uuid::from_u128(42))]
        );
    }
}

/// `PersistFailed` means Google already holds the event with its link, and a
/// transport failure may mean the same; revoking the meeting would strand
/// every attendee on a dead link.
#[tokio::test]
async fn an_event_that_may_have_reached_the_provider_keeps_its_meeting() {
    for ambiguous in [
        CalendarMutationError::PersistFailed("db down".to_string()),
        CalendarMutationError::Retryable("timeout".to_string()),
    ] {
        let mutations = FakeMutations::failing_with(ambiguous);
        let links = FakeMeetingLinks::default();

        let error = create_event_with_macro_call(
            &mutations,
            &links,
            "macro|owner@example.com",
            None,
            None,
            draft(),
        )
        .await
        .unwrap_err();
        assert!(matches!(error, MacroCallEventError::Calendar(_)));
        assert!(links.cancelled.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn a_failed_meeting_writes_nothing_to_the_calendar() {
    let mutations = FakeMutations::default();
    let links = FakeMeetingLinks {
        fail_create: true,
        ..FakeMeetingLinks::default()
    };

    let error = create_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        None,
        None,
        draft(),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        MacroCallEventError::MeetingLink(MeetingLinkError::Failed(_))
    ));
    assert!(mutations.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn out_of_office_and_provider_conferencing_are_refused_before_minting() {
    let mutations = FakeMutations::default();
    let links = FakeMeetingLinks::default();

    for draft in [
        CalendarEventDraft {
            out_of_office: Some(OutOfOfficeProperties::default()),
            ..draft()
        },
        CalendarEventDraft {
            conference: Some(ConferenceChange::GoogleMeet),
            ..draft()
        },
    ] {
        let error = create_event_with_macro_call(
            &mutations,
            &links,
            "macro|owner@example.com",
            None,
            None,
            draft,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            error,
            MacroCallEventError::Calendar(CalendarMutationError::InvalidInput(_))
        ));
    }
    assert!(links.requests.lock().unwrap().is_empty());
    assert!(mutations.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unwired_host_refuses_the_call_without_touching_the_calendar() {
    let mutations = FakeMutations::default();

    let error = create_event_with_macro_call(
        &mutations,
        &UnavailableMeetingLinks,
        "macro|owner@example.com",
        None,
        None,
        draft(),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        MacroCallEventError::MeetingLink(MeetingLinkError::Unavailable)
    ));
    assert!(mutations.created.lock().unwrap().is_empty());
}

fn stored_details() -> EventDetails {
    EventDetails {
        title: "Standup".to_string(),
        description: Some("<p>Agenda</p>".to_string()),
        location: Some("Room 4".to_string()),
        visibility: EventVisibility::Default,
        time: Some(timed()),
        recurrence_lines: Vec::new(),
        has_conference: true,
    }
}

fn mutations_holding(details: EventDetails) -> FakeMutations {
    FakeMutations {
        details: Mutex::new(Some(details)),
        ..FakeMutations::default()
    }
}

#[tokio::test]
async fn switching_replaces_the_conference_with_a_call_in_one_write() {
    let mutations = mutations_holding(stored_details());
    let links = FakeMeetingLinks::default();
    let event_id = Uuid::from_u128(7);
    let calendar_id = Uuid::from_u128(3);

    update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        event_id,
        Some(calendar_id),
        CalendarEventPatch::default(),
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    let requests = links.requests.lock().unwrap();
    let (requester, request) = requests.first().expect("one meeting minted");
    assert_eq!(requester, "macro|owner@example.com");
    assert_eq!(request.title, "Standup");
    assert_eq!(
        request.scheduled_start,
        Some(Utc.with_ymd_and_hms(2026, 8, 20, 17, 0, 0).unwrap())
    );

    let updated = mutations.updated.lock().unwrap();
    assert_eq!(updated.len(), 1);
    let (written_id, written_calendar, patch, scope) = updated.first().expect("one write");
    assert_eq!(*written_id, event_id);
    assert_eq!(*written_calendar, Some(calendar_id));
    assert_eq!(*scope, CalendarUpdateScope::All);
    assert_eq!(patch.conference, Some(ConferenceChange::Removed));
    assert_eq!(patch.location.as_deref(), Some("Room 4"));
    assert_eq!(
        patch.description.as_deref(),
        Some(
            format!("<p>Agenda</p>\n<p>Join Macro call: <a href=\"{URL}\">{URL}</a></p>").as_str()
        )
    );
    assert!(links.cancelled.lock().unwrap().is_empty());
}

#[tokio::test]
async fn switching_applies_the_changes_the_patch_carries() {
    let mutations = mutations_holding(EventDetails {
        has_conference: false,
        ..stored_details()
    });
    let links = FakeMeetingLinks::default();
    let moved = EventTime::Timed {
        starts_at: Utc.with_ymd_and_hms(2026, 8, 21, 17, 0, 0).unwrap(),
        ends_at: Utc.with_ymd_and_hms(2026, 8, 21, 18, 0, 0).unwrap(),
        time_zone: None,
    };

    update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch {
            title: Some("Retro".to_string()),
            description: Some("New agenda".to_string()),
            location: Some(String::new()),
            time: Some(moved.clone()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    let requests = links.requests.lock().unwrap();
    let (_, request) = requests.first().expect("one meeting minted");
    assert_eq!(request.title, "Retro");
    assert_eq!(
        request.scheduled_start,
        Some(Utc.with_ymd_and_hms(2026, 8, 21, 17, 0, 0).unwrap())
    );

    let updated = mutations.updated.lock().unwrap();
    let (_, _, patch, _) = updated.first().expect("one write");
    assert_eq!(patch.conference, None);
    assert_eq!(patch.time, Some(moved));
    assert_eq!(patch.location.as_deref(), Some(URL));
    assert_eq!(
        patch.description.as_deref(),
        Some(format!("New agenda\n<p>Join Macro call: <a href=\"{URL}\">{URL}</a></p>").as_str())
    );
}

#[tokio::test]
async fn switching_an_event_that_holds_a_call_keeps_it_and_drops_the_conference() {
    let (description, location) = attach_macro_call(Some("<p>Agenda</p>"), None, URL);
    let mutations = mutations_holding(EventDetails {
        description: Some(description),
        location: Some(location),
        ..stored_details()
    });
    let links = FakeMeetingLinks::default();

    update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch::default(),
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert!(links.requests.lock().unwrap().is_empty());
    let updated = mutations.updated.lock().unwrap();
    let (_, _, patch, _) = updated.first().expect("one write");
    assert_eq!(patch.conference, Some(ConferenceChange::Removed));
    assert_eq!(patch.description, None);
    assert_eq!(patch.location, None);
}

#[tokio::test]
async fn retrying_a_finished_switch_writes_nothing() {
    let (description, location) = attach_macro_call(None, None, URL);
    let mutations = mutations_holding(EventDetails {
        description: Some(description),
        location: Some(location),
        has_conference: false,
        ..stored_details()
    });
    let links = FakeMeetingLinks::default();

    let error = update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch::default(),
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(
        error,
        MacroCallEventError::Calendar(CalendarMutationError::InvalidInput(_))
    ));
    assert!(links.requests.lock().unwrap().is_empty());
    assert!(mutations.updated.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_replacement_description_keeps_the_stored_calls_join_line() {
    let (description, location) = attach_macro_call(None, None, URL);
    let mutations = mutations_holding(EventDetails {
        description: Some(description),
        location: Some(location),
        has_conference: false,
        ..stored_details()
    });
    let links = FakeMeetingLinks::default();

    update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch {
            description: Some("Agenda".to_string()),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap();

    assert!(links.requests.lock().unwrap().is_empty());
    let updated = mutations.updated.lock().unwrap();
    let (_, _, patch, _) = updated.first().expect("one write");
    let written = patch.description.as_deref().expect("description written");
    assert!(written.starts_with("Agenda"));
    assert_eq!(
        first_macro_call_url(None, Some(written)).as_deref(),
        Some(URL)
    );
}

#[tokio::test]
async fn a_switch_refused_before_the_provider_cancels_the_fresh_meeting() {
    for refused in [
        CalendarMutationError::GuestsCannotModify,
        CalendarMutationError::ProviderRejected("cannot remove Teams".to_string()),
    ] {
        let mutations = mutations_holding(stored_details());
        *mutations.update_error.lock().unwrap() = Some(refused);
        let links = FakeMeetingLinks::default();

        let error = update_event_with_macro_call(
            &mutations,
            &links,
            "macro|owner@example.com",
            Uuid::from_u128(7),
            None,
            CalendarEventPatch::default(),
            CalendarUpdateScope::All,
        )
        .await
        .unwrap_err();

        assert!(matches!(error, MacroCallEventError::Calendar(_)));
        assert_eq!(
            *links.cancelled.lock().unwrap(),
            vec![("macro|owner@example.com".to_string(), Uuid::from_u128(42))]
        );
    }
}

#[tokio::test]
async fn a_switch_whose_write_may_have_landed_keeps_the_meeting() {
    let mutations = mutations_holding(stored_details());
    *mutations.update_error.lock().unwrap() =
        Some(CalendarMutationError::Retryable("timed out".to_string()));
    let links = FakeMeetingLinks::default();

    update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch::default(),
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(links.cancelled.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_mint_leaves_the_event_untouched() {
    let mutations = mutations_holding(stored_details());
    let links = FakeMeetingLinks {
        fail_create: true,
        ..FakeMeetingLinks::default()
    };

    let error = update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch::default(),
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(error, MacroCallEventError::MeetingLink(_)));
    assert!(mutations.updated.lock().unwrap().is_empty());
}

#[tokio::test]
async fn switching_refuses_an_explicit_provider_conference() {
    let mutations = mutations_holding(stored_details());
    let links = FakeMeetingLinks::default();

    let error = update_event_with_macro_call(
        &mutations,
        &links,
        "macro|owner@example.com",
        Uuid::from_u128(7),
        None,
        CalendarEventPatch {
            conference: Some(ConferenceChange::GoogleMeet),
            ..CalendarEventPatch::default()
        },
        CalendarUpdateScope::All,
    )
    .await
    .unwrap_err();

    assert!(matches!(
        error,
        MacroCallEventError::Calendar(CalendarMutationError::InvalidInput(_))
    ));
    assert!(links.requests.lock().unwrap().is_empty());
}
