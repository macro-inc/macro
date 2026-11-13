use super::*;
use crate::domain::ports::AttachmentReadiness;
use calendar_events::domain::{
    ics::CalendarEventIcs,
    join_requests::CalendarJoinRequest,
    models::{
        AttendeeResponseStatus, CalendarAttendee, CalendarCapabilities, CalendarEventPatch,
        CalendarEventSourceContent, CalendarFreshness, CalendarMentionPreview,
        CalendarMentionRequestItem, CalendarOccurrence, CalendarOccurrenceCursor, CalendarProvider,
        CalendarSyncFailure, CalendarSyncHealth, CalendarSyncStatus, EventReminders, EventStatus,
        EventType, EventVisibility, GuestPolicy, MeetingCopy, OccurrenceException,
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
    status: CalendarSyncStatus,
    health: CalendarSyncHealth,
}

impl CalendarSyncHealthReader for FakeOccurrences {
    async fn calendar_sync_health(
        &self,
        _requester_id: &str,
    ) -> Result<CalendarSyncHealth, Report> {
        Ok(self.health.clone())
    }
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
        Ok(self.status)
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

/// The calendar service's listing, which only booking creation and form
/// attachment read: busy time must never read it (see `busy`), so `None`
/// fails a test that does.
struct FakeMutations(Option<Vec<VisibleCalendar>>);

impl calendar_events::domain::ports::CalendarMutationService for FakeMutations {
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
        Ok(self
            .0
            .clone()
            .expect("busy time reads calendars in process"))
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

impl CalendarCreationRecoveryService for FakeMutations {
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
            status: CalendarSyncStatus::Ready,
            health: CalendarSyncHealth {
                calendars: vec![synced(PRIMARY, None), synced(COWORKER, None)],
                unlisted_inboxes: Vec::new(),
            },
        }),
        Arc::new(FakeMutations(None)),
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

/// What a calendar that retries after a transient failure shows in Settings.
const RETRYING: &str = "Microsoft calendar synchronization will retry";

/// A calendar's sync state: its last successful sync `synced_minutes_ago`
/// (`None` before its first), with the latest attempt's `failure`.
fn freshness(
    calendar_id: Uuid,
    synced_minutes_ago: Option<i64>,
    failure: Option<CalendarSyncFailure>,
) -> CalendarFreshness {
    CalendarFreshness {
        calendar_id,
        refresh_due_at: synced_minutes_ago.map(|minutes| Utc::now() - Duration::minutes(minutes)),
        failure,
    }
}

/// A calendar whose last sync succeeded a minute ago, unless `failure` says
/// the attempt after it failed.
fn synced(calendar_id: Uuid, failure: Option<CalendarSyncFailure>) -> CalendarFreshness {
    freshness(calendar_id, Some(1), failure)
}

/// The coworker's calendar, counting toward availability as `counts`, with
/// the sync error its Settings row shows.
fn coworker(counts: bool, badge: Option<&str>) -> VisibleCalendar {
    VisibleCalendar {
        sync_error: badge.map(str::to_owned),
        ..calendar(COWORKER, "Coworker", false, counts)
    }
}

/// The host's calendars holding the coworker's meeting: what the in-process
/// reads return (`status` is the account-level sync status) and, as
/// `listing`, the calendar service's listing booking creation reads.
fn host(
    calendars: Vec<VisibleCalendar>,
    health: CalendarSyncHealth,
    status: CalendarSyncStatus,
) -> MacroCalendars<FakeOccurrences, FakeMutations> {
    MacroCalendars::new(
        Arc::new(FakeOccurrences {
            calendars: calendars.clone(),
            listings: vec![listing(COWORKER)],
            status,
            health,
        }),
        Arc::new(FakeMutations(Some(calendars))),
        None,
    )
}

async fn busy_for(
    host: &MacroCalendars<FakeOccurrences, FakeMutations>,
) -> Result<Vec<BusyRange>, Error> {
    host.busy(
        &[HOST.to_owned()],
        starts_at() - Duration::hours(1),
        starts_at() + Duration::hours(2),
        None,
    )
    .await
}

/// Busy time beside the host's healthy primary calendar, with the coworker's
/// calendar in the sync state `coworker_sync`.
async fn busy_beside(
    coworker: VisibleCalendar,
    coworker_sync: CalendarFreshness,
    status: CalendarSyncStatus,
) -> Result<Vec<BusyRange>, Error> {
    busy_for(&host(
        vec![calendar(PRIMARY, "Host", true, true), coworker],
        CalendarSyncHealth {
            calendars: vec![synced(PRIMARY, None), coworker_sync],
            unlisted_inboxes: Vec::new(),
        },
        status,
    ))
    .await
}

#[tokio::test]
async fn a_failing_calendar_with_busy_off_never_blocks_booking() {
    // It last synced three days ago and then failed for good.
    let busy = busy_beside(
        coworker(false, Some("Not Found")),
        freshness(
            COWORKER,
            Some(3 * 24 * 60),
            Some(CalendarSyncFailure::Permanent),
        ),
        CalendarSyncStatus::Ready,
    )
    .await
    .unwrap();
    assert!(busy.is_empty());
}

#[tokio::test]
async fn a_counting_calendar_failing_briefly_offers_time_around_its_stored_events() {
    let busy = busy_beside(
        coworker(true, Some(RETRYING)),
        freshness(COWORKER, Some(5), Some(CalendarSyncFailure::Transient)),
        CalendarSyncStatus::Ready,
    )
    .await
    .unwrap();
    assert_eq!(busy.len(), 1);
    assert_eq!(busy[0].start, starts_at());
}

#[tokio::test]
async fn a_counting_calendar_failing_past_the_window_refuses() {
    let refused = busy_beside(
        coworker(true, Some(RETRYING)),
        freshness(COWORKER, Some(120), Some(CalendarSyncFailure::Transient)),
        CalendarSyncStatus::Ready,
    )
    .await;
    assert!(matches!(refused, Err(Error::CalendarUnavailable)));
}

#[tokio::test]
async fn a_counting_calendar_failing_for_good_refuses_at_once() {
    let refused = busy_beside(
        coworker(true, Some("Microsoft could not synchronize this calendar")),
        synced(COWORKER, Some(CalendarSyncFailure::Permanent)),
        CalendarSyncStatus::Ready,
    )
    .await;
    assert!(matches!(refused, Err(Error::CalendarUnavailable)));
}

#[tokio::test]
async fn a_counting_calendar_that_lost_its_grant_refuses_at_once() {
    let refused = busy_beside(
        coworker(true, Some("Reconnect Microsoft calendar")),
        synced(COWORKER, Some(CalendarSyncFailure::ReauthRequired)),
        CalendarSyncStatus::Ready,
    )
    .await;
    assert!(matches!(refused, Err(Error::CalendarUnavailable)));
}

#[tokio::test]
async fn an_account_catching_up_only_on_a_busy_off_calendar_still_offers_time() {
    // Outlook keeps an account syncing until each of its calendars has
    // synced once.
    let busy = busy_beside(
        coworker(false, None),
        freshness(COWORKER, None, Some(CalendarSyncFailure::Transient)),
        CalendarSyncStatus::Syncing,
    )
    .await
    .unwrap();
    assert!(busy.is_empty());
}

#[tokio::test]
async fn a_counting_calendar_on_its_first_sync_refuses() {
    let refused = busy_beside(
        coworker(true, None),
        freshness(COWORKER, None, Some(CalendarSyncFailure::Transient)),
        CalendarSyncStatus::Syncing,
    )
    .await;
    assert!(matches!(refused, Err(Error::CalendarUnavailable)));
}

#[tokio::test]
async fn an_inbox_whose_calendars_are_not_listed_yet_refuses() {
    let refused = busy_for(&host(
        vec![calendar(PRIMARY, "Host", true, true)],
        CalendarSyncHealth {
            calendars: vec![synced(PRIMARY, None)],
            unlisted_inboxes: vec![Uuid::from_u128(0x4)],
        },
        CalendarSyncStatus::Syncing,
    ))
    .await;
    assert!(matches!(refused, Err(Error::CalendarUnavailable)));
}

#[tokio::test]
async fn a_primary_calendar_failing_briefly_still_takes_the_booking() {
    let host = host(
        vec![VisibleCalendar {
            sync_error: Some(RETRYING.to_owned()),
            ..calendar(PRIMARY, "Host", true, true)
        }],
        CalendarSyncHealth {
            calendars: vec![freshness(
                PRIMARY,
                Some(5),
                Some(CalendarSyncFailure::Transient),
            )],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Ready,
    );
    assert!(busy_for(&host).await.is_ok());
    assert_eq!(host.creation_calendar(HOST).await.unwrap(), PRIMARY);
}

#[tokio::test]
async fn a_primary_calendar_that_lost_its_grant_takes_no_booking_even_with_busy_off() {
    let host = host(
        vec![
            VisibleCalendar {
                sync_error: Some("Reconnect Microsoft calendar".to_owned()),
                ..calendar(PRIMARY, "Host", true, false)
            },
            coworker(true, None),
        ],
        CalendarSyncHealth {
            calendars: vec![
                synced(PRIMARY, Some(CalendarSyncFailure::ReauthRequired)),
                synced(COWORKER, None),
            ],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Ready,
    );
    assert!(matches!(
        busy_for(&host).await,
        Err(Error::CalendarUnavailable)
    ));
    assert!(matches!(
        host.creation_calendar(HOST).await,
        Err(Error::CalendarUnavailable)
    ));
}

#[tokio::test]
async fn attaching_a_booking_link_follows_the_availability_rule() {
    let primary = || calendar(PRIMARY, "Host", true, true);
    let busy_off_failing = host(
        vec![primary(), coworker(false, Some("Not Found"))],
        CalendarSyncHealth {
            calendars: vec![
                synced(PRIMARY, None),
                synced(COWORKER, Some(CalendarSyncFailure::Permanent)),
            ],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Ready,
    );
    assert!(busy_off_failing.ready(HOST).await.is_ok());

    let counting_stale = host(
        vec![primary(), coworker(true, Some(RETRYING))],
        CalendarSyncHealth {
            calendars: vec![
                synced(PRIMARY, None),
                freshness(COWORKER, Some(120), Some(CalendarSyncFailure::Transient)),
            ],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Ready,
    );
    assert!(matches!(
        counting_stale.ready(HOST).await,
        Err(Error::CalendarUnavailable)
    ));
}

#[tokio::test]
async fn a_calendar_listed_after_the_calendar_listing_counts_until_it_syncs() {
    let unsynced = busy_for(&host(
        vec![calendar(PRIMARY, "Host", true, true)],
        CalendarSyncHealth {
            calendars: vec![
                synced(PRIMARY, None),
                freshness(COWORKER, None, Some(CalendarSyncFailure::Transient)),
            ],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Syncing,
    ))
    .await;
    assert!(matches!(unsynced, Err(Error::CalendarUnavailable)));

    let synced_since = busy_for(&host(
        vec![calendar(PRIMARY, "Host", true, true)],
        CalendarSyncHealth {
            calendars: vec![synced(PRIMARY, None), synced(COWORKER, None)],
            unlisted_inboxes: Vec::new(),
        },
        CalendarSyncStatus::Ready,
    ))
    .await
    .unwrap();
    assert_eq!(synced_since.len(), 1, "its events still block their time");
}
