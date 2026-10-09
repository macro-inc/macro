use std::sync::{Arc, Mutex};

use calendar_events::domain::{
    changes::{CalendarChangeQueryService, CalendarChangesPage, CalendarWatermark},
    models::{
        CalendarEvent, CalendarMentionPreview, CalendarMentionRequestItem, CalendarOccurrence,
        CalendarOccurrenceCursor, CalendarSyncStatus, EventReminders, EventStatus, EventTime,
        EventTransparency, EventType, EventVisibility, OccurrenceException, OccurrenceListing,
        OccurrenceRange, TeamOutOfOffice, VisibleCalendar,
    },
    ports::CalendarOccurrenceService,
};
use chrono::TimeZone;
use graphql_calendar::CalendarGraphqlContext;
use rootcause::Report;

use super::*;

const EVENT_ID: Uuid = Uuid::from_u128(0xe1);
const LINK_ID: Uuid = Uuid::from_u128(0x11);

#[derive(Default)]
struct RecordingCalendarReads {
    viewers: Mutex<Vec<String>>,
}

fn listing() -> OccurrenceListing {
    let starts_at = chrono::Utc.with_ymd_and_hms(2026, 10, 6, 15, 0, 0).unwrap();
    let time = EventTime::Timed {
        starts_at,
        ends_at: starts_at + chrono::Duration::hours(1),
        time_zone: None,
    };
    OccurrenceListing {
        event: CalendarEvent {
            id: EVENT_ID,
            owner_id: VALID_USER_ID.to_owned(),
            ical_uid: "uid@example.com".to_owned(),
            calendar_id: None,
            sources: Vec::new(),
            title: "Planning".to_owned(),
            description: None,
            location: None,
            status: EventStatus::Confirmed,
            visibility: EventVisibility::Default,
            transparency: EventTransparency::Opaque,
            event_type: EventType::Default,
            time: time.clone(),
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
            created_at: starts_at,
            updated_at: starts_at,
        },
        occurrence: CalendarOccurrence {
            event_id: EVENT_ID,
            occurrence_key: time.occurrence_key(),
            recurrence_id: None,
            time,
            is_cancelled: false,
        },
        link_id: LINK_ID,
        exception: OccurrenceException::default(),
    }
}

impl CalendarOccurrenceService for RecordingCalendarReads {
    async fn list_occurrences(
        &self,
        requester_id: &str,
        _range: OccurrenceRange,
        _cursor: Option<CalendarOccurrenceCursor>,
        _limit: u16,
    ) -> Result<Vec<OccurrenceListing>, Report> {
        self.viewers.lock().unwrap().push(requester_id.to_owned());
        Ok(vec![listing()])
    }

    async fn sync_status(&self, _requester_id: &str) -> Result<CalendarSyncStatus, Report> {
        Ok(CalendarSyncStatus::Ready)
    }

    async fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, Report> {
        self.viewers.lock().unwrap().push(requester_id.to_owned());
        Ok(vec![VisibleCalendar {
            id: Uuid::from_u128(0xca),
            email_link_id: LINK_ID,
            email_address: "user@example.com".to_owned(),
            name: "Work".to_owned(),
            color: None,
            is_primary: true,
            is_writable: true,
            is_subscription: false,
            sync_error: None,
            default_reminders: Vec::new(),
        }])
    }

    async fn mention_previews(
        &self,
        _requester_id: &str,
        _items: Vec<CalendarMentionRequestItem>,
    ) -> Result<Vec<CalendarMentionPreview>, Report> {
        unreachable!("not part of the calendar user fields")
    }

    async fn list_team_out_of_office(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _limit: u16,
    ) -> Result<Vec<TeamOutOfOffice>, Report> {
        unreachable!("not part of the calendar user fields")
    }

    async fn primary_time_zone(&self, _requester_id: &str) -> Result<Option<String>, Report> {
        unreachable!("not part of the calendar user fields")
    }
}

impl CalendarChangeQueryService for RecordingCalendarReads {
    async fn current_watermark(&self, requester_id: &str) -> Result<CalendarWatermark, Report> {
        self.viewers.lock().unwrap().push(requester_id.to_owned());
        Ok(CalendarWatermark::default())
    }

    async fn changes_since(
        &self,
        requester_id: &str,
        _since: CalendarWatermark,
    ) -> Result<CalendarChangesPage, Report> {
        self.viewers.lock().unwrap().push(requester_id.to_owned());
        Ok(CalendarChangesPage {
            reset_required: true,
            ..CalendarChangesPage::default()
        })
    }
    async fn event_change(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<calendar_events::domain::changes::CalendarEventChange>, Report> {
        Ok(None)
    }
}

#[tokio::test]
async fn calendar_fields_read_through_request_data_for_the_viewer() {
    let harness = harness();
    let reads = Arc::new(RecordingCalendarReads::default());
    let context = CalendarGraphqlContext::new(Arc::clone(&reads), Arc::clone(&reads));

    let id_only = harness
        .schema
        .execute(
            harness
                .request("{ user { id } }", authenticated_parts())
                .data(context.clone()),
        )
        .await;
    assert!(id_only.errors.is_empty(), "{:?}", id_only.errors);
    assert!(reads.viewers.lock().unwrap().is_empty());

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user {
                        id
                        calendars { id linkId }
                        calendarOccurrences(input: {
                            start: "2026-10-05T00:00:00Z", end: "2026-10-12T00:00:00Z"
                        }) {
                            nodes { id eventId linkId event { id title } }
                            hasNextPage syncStatus watermark { linkId seq }
                        }
                        calendarChanges(input: { since: [] }) { resetRequired }
                    } }"#,
                    authenticated_parts(),
                )
                .data(context),
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let user = &data["user"];
    assert_eq!(user["calendars"][0]["linkId"], LINK_ID.to_string());
    let node = &user["calendarOccurrences"]["nodes"][0];
    assert_eq!(node["id"], format!("{EVENT_ID}:2026-10-06T15:00:00+00:00"));
    assert_eq!(node["event"]["title"], "Planning");
    assert_eq!(user["calendarOccurrences"]["syncStatus"], "READY");
    assert_eq!(user["calendarChanges"]["resetRequired"], true);
    let viewers = reads.viewers.lock().unwrap();
    assert_eq!(viewers.len(), 4);
    assert!(viewers.iter().all(|viewer| viewer == VALID_USER_ID));
}

#[tokio::test]
async fn calendar_fields_fail_without_the_calendar_context() {
    let harness = harness();

    let response = harness
        .schema
        .execute(harness.request("{ user { id calendars { id } } }", authenticated_parts()))
        .await;

    assert_eq!(response.errors.len(), 1);
}

#[derive(Default)]
struct RecordingCalendarMutations {
    deleted: Mutex<Vec<(String, Uuid)>>,
}

impl calendar_events::domain::ports::CalendarMutationService for RecordingCalendarMutations {
    async fn create_event(
        &self,
        _requester_id: &str,
        _email_link_id: Option<Uuid>,
        _calendar_id: Option<Uuid>,
        _draft: calendar_events::domain::models::CalendarEventDraft,
    ) -> Result<CalendarEvent, calendar_events::domain::ports::CalendarMutationError> {
        unreachable!("only deletion is exercised")
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, calendar_events::domain::ports::CalendarMutationError> {
        unreachable!("only deletion is exercised")
    }

    async fn update_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _patch: calendar_events::domain::models::CalendarEventPatch,
        _scope: calendar_events::domain::ports::CalendarUpdateScope,
    ) -> Result<CalendarEvent, calendar_events::domain::ports::CalendarMutationError> {
        unreachable!("only deletion is exercised")
    }

    async fn delete_event(
        &self,
        requester_id: &str,
        event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _scope: calendar_events::domain::ports::CalendarDeletionScope,
    ) -> Result<(), calendar_events::domain::ports::CalendarMutationError> {
        self.deleted
            .lock()
            .unwrap()
            .push((requester_id.to_owned(), event_id));
        Ok(())
    }

    async fn respond_to_event(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
        _calendar_id: Option<Uuid>,
        _response: calendar_events::domain::models::AttendeeResponseStatus,
        _scope: calendar_events::domain::ports::CalendarRsvpScope,
        _responding_email: Option<String>,
    ) -> Result<CalendarEvent, calendar_events::domain::ports::CalendarMutationError> {
        unreachable!("only deletion is exercised")
    }

    async fn disconnect_calendar(
        &self,
        _requester_id: &str,
        _email_link_id: Uuid,
    ) -> Result<(), calendar_events::domain::ports::CalendarMutationError> {
        unreachable!("only deletion is exercised")
    }
}

#[tokio::test]
async fn calendar_mutations_run_for_the_authenticated_viewer() {
    let harness = harness();
    let mutations = Arc::new(RecordingCalendarMutations::default());
    let reads = Arc::new(RecordingCalendarReads::default());
    let context =
        graphql_calendar::CalendarGraphqlMutationContext::new(Arc::clone(&mutations), reads);

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    &format!(
                        r#"mutation {{ deleteCalendarEvent(input: {{ eventId: "{EVENT_ID}" }}) {{ deletedEventId }} }}"#
                    ),
                    authenticated_parts(),
                )
                .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap())
                .data(context),
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["deleteCalendarEvent"]["deletedEventId"],
        EVENT_ID.to_string()
    );
    assert_eq!(
        *mutations.deleted.lock().unwrap(),
        vec![(VALID_USER_ID.to_owned(), EVENT_ID)]
    );
}
