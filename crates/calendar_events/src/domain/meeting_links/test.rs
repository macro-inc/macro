use std::sync::Mutex;

use chrono::{NaiveDate, TimeZone, Utc};

use super::*;
use crate::domain::models::{
    AttendeeResponseStatus, CalendarEventPatch, ConferenceChange, EventReminders, EventStatus,
    EventTransparency, EventType, EventVisibility, OutOfOfficeProperties, VisibleCalendar,
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
    }
}

#[derive(Default)]
struct FakeMutations {
    created: Mutex<Vec<CalendarEventDraft>>,
    fail_create: bool,
}

impl CalendarMutationService for FakeMutations {
    async fn create_event(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
        draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        if self.fail_create {
            return Err(CalendarMutationError::NoWritableCalendar);
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
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _patch: CalendarEventPatch,
        _scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("the link is written with the create, never as a follow-up patch")
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

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("creating with a Macro call disconnects nothing")
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

    let event = create_event_with_macro_call(
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
    assert_eq!(event.id, Uuid::from_u128(7));

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
async fn a_failed_calendar_write_cancels_the_fresh_meeting() {
    let mutations = FakeMutations {
        fail_create: true,
        ..FakeMutations::default()
    };
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
    assert!(matches!(
        error,
        CreateEventWithMacroCallError::Calendar(CalendarMutationError::NoWritableCalendar)
    ));
    assert_eq!(
        *links.cancelled.lock().unwrap(),
        vec![("macro|owner@example.com".to_string(), Uuid::from_u128(42))]
    );
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
        CreateEventWithMacroCallError::MeetingLink(MeetingLinkError::Failed(_))
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
            CreateEventWithMacroCallError::Calendar(CalendarMutationError::InvalidInput(_))
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
        CreateEventWithMacroCallError::MeetingLink(MeetingLinkError::Unavailable)
    ));
    assert!(mutations.created.lock().unwrap().is_empty());
}
