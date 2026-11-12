use super::*;
use calendar_events::domain::{
    ics::CalendarEventIcs,
    join_requests::CalendarJoinRequest,
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarCapabilities, CalendarEventPatch,
        CalendarEventSourceContent, CalendarMentionPreview, CalendarMentionRequestItem,
        CalendarOccurrence, CalendarOccurrenceCursor, CalendarProvider, EventReminders,
        EventStatus, EventType, EventVisibility, GuestPolicy, MeetingCopy, OccurrenceException,
        OccurrenceListing, TeamOutOfOffice, ViewerCapabilities, VisibleCalendar,
    },
    ports::{CalendarMutationError, CalendarRsvpScope, CalendarUpdateScope},
};
use chrono::TimeZone;
use rootcause::Report;

const URL: &str = "https://macro.com/app/meet/join/0123456789abcdef0123456789abcdef";
const HOST: &str = "macro|host@example.com";
const HOST_EMAIL: &str = "host@example.com";
const PRIMARY: Uuid = Uuid::from_u128(0x1);
const COWORKER: Uuid = Uuid::from_u128(0x2);
const LINK: Uuid = Uuid::from_u128(0x3);

#[test]
fn an_idempotent_replay_keeps_the_link_already_on_the_event() {
    let description = format!(r#"<p>Join Macro call: <a href="{URL}">{URL}</a></p>"#);
    assert!(carries_url(None, Some(&description), URL));
    assert_eq!(
        first_macro_call_url(Some("Office"), Some(&description)).as_deref(),
        Some(URL)
    );
    assert!(!carries_url(Some("Office"), Some("notes"), URL));
}

fn calendar(id: Uuid, name: &str, is_primary: bool, counts: bool) -> VisibleCalendar {
    VisibleCalendar {
        id,
        email_link_id: LINK,
        email_address: HOST_EMAIL.to_owned(),
        name: name.to_owned(),
        color: None,
        is_primary,
        is_writable: is_primary,
        is_subscription: false,
        contributes_to_availability: counts,
        sync_error: None,
        provider: CalendarProvider::Google,
        capabilities: CalendarCapabilities::google(),
        default_reminders: Vec::new(),
    }
}

fn starts_at() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 16, 15, 0, 0).unwrap()
}

fn host_row(status: AttendeeResponseStatus, is_organizer: bool) -> CalendarAttendee {
    CalendarAttendee {
        email: HOST_EMAIL.to_owned(),
        display_name: None,
        response_status: status,
        is_organizer,
        is_optional: false,
        is_self: true,
        comment: None,
    }
}

fn guest_row(email: &str) -> CalendarAttendee {
    CalendarAttendee {
        email: email.to_owned(),
        is_self: false,
        ..host_row(AttendeeResponseStatus::Accepted, false)
    }
}

fn copy_on(calendar_id: Uuid) -> CalendarEventSourceContent {
    CalendarEventSourceContent {
        calendar_id,
        title: "Planning".to_owned(),
        description: None,
        location: None,
        event_type: EventType::Default,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        is_read_only: false,
        reminders: EventReminders::default(),
        creator_email: None,
        creator_name: None,
    }
}

/// A coworker's meeting on `calendar_id` that the host is not invited to.
fn listing(calendar_id: Uuid) -> OccurrenceListing {
    let time = EventTime::Timed {
        starts_at: starts_at(),
        ends_at: starts_at() + Duration::minutes(30),
        time_zone: None,
    };
    let id = Uuid::from_u128(0x10);
    OccurrenceListing {
        event: CalendarEvent {
            id,
            owner_id: HOST.to_owned(),
            ical_uid: "planning@example.com".to_owned(),
            calendar_id: Some(calendar_id),
            sources: vec![copy_on(calendar_id)],
            title: "Planning".to_owned(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            event_type: EventType::Default,
            time: time.clone(),
            recurrence_lines: Vec::new(),
            organizer_email: Some("coworker@example.com".to_owned()),
            organizer_name: None,
            creator_email: None,
            creator_name: None,
            conference_url: None,
            conference_provider: None,
            sequence: 0,
            is_read_only: true,
            attendees: Vec::new(),
            reminders: EventReminders::default(),
            guest_policy: GuestPolicy::default(),
            is_snapshot: false,
            viewer_can: ViewerCapabilities::NONE,
            created_at: starts_at(),
            updated_at: starts_at(),
        },
        occurrence: CalendarOccurrence {
            event_id: id,
            occurrence_key: time.occurrence_key(),
            recurrence_id: None,
            time,
            is_cancelled: false,
        },
        link_id: LINK,
        exception: OccurrenceException::default(),
    }
}

struct FakeOccurrences {
    calendars: Vec<VisibleCalendar>,
    listings: Vec<OccurrenceListing>,
}

impl CalendarOccurrenceService for FakeOccurrences {
    async fn list_occurrences(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _cursor: Option<CalendarOccurrenceCursor>,
        _limit: u16,
    ) -> Result<Vec<OccurrenceListing>, Report> {
        Ok(self.listings.clone())
    }

    async fn sync_status(&self, _requester_id: &str) -> Result<CalendarSyncStatus, Report> {
        Ok(CalendarSyncStatus::Ready)
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, Report> {
        Ok(self.calendars.clone())
    }

    async fn mention_previews(
        &self,
        _requester_id: &str,
        _items: Vec<CalendarMentionRequestItem>,
    ) -> Result<Vec<CalendarMentionPreview>, Report> {
        unreachable!("busy time resolves no mentions")
    }

    async fn list_team_out_of_office(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _limit: u16,
    ) -> Result<Vec<TeamOutOfOffice>, Report> {
        unreachable!("busy time reads no teammate")
    }

    async fn primary_time_zone(&self, _requester_id: &str) -> Result<Option<String>, Report> {
        unreachable!("busy time needs no zone")
    }

    async fn meeting_copies(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Vec<MeetingCopy>, Report> {
        unreachable!("busy time lists no copies")
    }

    async fn event_ics(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<CalendarEventIcs>, Report> {
        unreachable!("busy time exports nothing")
    }
}

/// Busy time must never read the calendar service's listing; see `busy`.
struct NoMutations;

impl calendar_events::domain::ports::CalendarMutationService for NoMutations {
    async fn create_event(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
        _draft: CalendarEventDraft,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, CalendarMutationError> {
        unreachable!("busy time reads calendars in process")
    }

    async fn update_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _patch: CalendarEventPatch,
        _scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }

    async fn delete_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _scope: CalendarDeletionScope,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("busy time writes nothing")
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
        unreachable!("busy time writes nothing")
    }

    async fn invite_guests(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _guests: Vec<CalendarAttendeeInput>,
        _scope: CalendarUpdateScope,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }

    async fn copy_shared_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
    ) -> Result<CalendarEvent, CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }

    async fn respond_to_join_request(
        &self,
        _requester_id: &str,
        _request_id: Uuid,
        _accept: bool,
    ) -> Result<CalendarJoinRequest, CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }
}

impl CalendarCreationRecoveryService for NoMutations {
    async fn delete_created_event(
        &self,
        _requester_id: &str,
        _calendar_id: Uuid,
        _creation_key: Uuid,
    ) -> Result<(), CalendarMutationError> {
        unreachable!("busy time writes nothing")
    }
}

/// The host's busy ranges with their primary calendar and a coworker's
/// calendar they follow, which counts toward availability as `coworker_counts`.
async fn busy_with(coworker_counts: bool, listing: OccurrenceListing) -> Vec<BusyRange> {
    let calendars = MacroCalendars::new(
        Arc::new(FakeOccurrences {
            calendars: vec![
                calendar(PRIMARY, "Host", true, true),
                calendar(COWORKER, "Coworker", false, coworker_counts),
            ],
            listings: vec![listing],
        }),
        Arc::new(NoMutations),
        None,
    );
    calendars
        .busy(
            &[HOST.to_owned()],
            starts_at() - Duration::hours(1),
            starts_at() + Duration::hours(2),
            None,
        )
        .await
        .unwrap()
}

#[tokio::test]
async fn a_calendar_turned_off_for_availability_frees_its_events() {
    assert!(busy_with(false, listing(COWORKER)).await.is_empty());
}

#[tokio::test]
async fn a_calendar_left_counting_blocks_its_events() {
    let busy = busy_with(true, listing(COWORKER)).await;
    assert_eq!(busy.len(), 1);
    assert_eq!(busy[0].host, HOST);
    assert_eq!(busy[0].start, starts_at());
}

#[tokio::test]
async fn a_copy_on_a_counted_calendar_blocks_the_event() {
    let mut meeting = listing(COWORKER);
    meeting.event.sources.push(copy_on(PRIMARY));
    assert_eq!(busy_with(false, meeting).await.len(), 1);
}

#[tokio::test]
async fn a_meeting_the_host_attends_blocks_time_on_any_calendar() {
    let mut meeting = listing(COWORKER);
    meeting.event.attendees = vec![host_row(AttendeeResponseStatus::Accepted, false)];
    assert_eq!(busy_with(false, meeting).await.len(), 1);
}

#[tokio::test]
async fn a_read_only_calendar_naming_the_host_organizer_is_no_attendance() {
    let mut meeting = listing(COWORKER);
    meeting.event.attendees = vec![
        host_row(AttendeeResponseStatus::Accepted, true),
        guest_row("guest@example.com"),
    ];
    assert!(busy_with(false, meeting).await.is_empty());
}

#[tokio::test]
async fn a_solo_event_listing_the_host_as_organizer_frees_with_its_calendar() {
    let mut entry = listing(COWORKER);
    entry.event.is_read_only = false;
    entry.event.attendees = vec![host_row(AttendeeResponseStatus::Accepted, true)];
    assert!(busy_with(false, entry).await.is_empty());
}

#[tokio::test]
async fn a_meeting_the_host_organizes_with_guests_blocks_time_on_any_calendar() {
    let mut meeting = listing(COWORKER);
    meeting.event.is_read_only = false;
    meeting.event.attendees = vec![
        host_row(AttendeeResponseStatus::Accepted, true),
        guest_row("guest@example.com"),
    ];
    assert_eq!(busy_with(false, meeting).await.len(), 1);
}

#[tokio::test]
async fn a_declined_meeting_never_blocks_time() {
    let mut meeting = listing(PRIMARY);
    meeting.event.attendees = vec![host_row(AttendeeResponseStatus::Declined, false)];
    assert!(busy_with(true, meeting).await.is_empty());
}

#[tokio::test]
async fn an_event_on_a_calendar_the_listing_does_not_know_still_blocks_time() {
    assert_eq!(
        busy_with(false, listing(Uuid::from_u128(0x99))).await.len(),
        1
    );
}

#[tokio::test]
async fn a_copy_on_an_unknown_calendar_blocks_time_beside_a_turned_off_one() {
    let mut meeting = listing(COWORKER);
    meeting.event.sources.push(copy_on(Uuid::from_u128(0x99)));
    assert_eq!(busy_with(false, meeting).await.len(), 1);
}

#[tokio::test]
async fn a_snapshot_on_a_turned_off_calendar_frees_the_host() {
    let mut snapshot = listing(COWORKER);
    snapshot.event.is_snapshot = true;
    snapshot.event.attendees = vec![host_row(AttendeeResponseStatus::Accepted, false)];
    assert!(busy_with(false, snapshot).await.is_empty());
}
