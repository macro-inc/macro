use std::sync::{Arc, Mutex};

use async_graphql::{EmptyMutation, EmptySubscription, Schema};
use calendar_events::domain::{
    changes::{
        CalendarChangeQueryService, CalendarChangesPage, CalendarEventChange,
        CalendarLinkWatermark, CalendarWatermark, EventOccurrence,
    },
    models::{
        CalendarMentionPreview, CalendarMentionRequestItem, CalendarOccurrenceCursor,
        CalendarSyncStatus, OccurrenceListing, OccurrenceRange, TeamOutOfOffice, VisibleCalendar,
    },
    ports::CalendarOccurrenceService,
    service::CalendarValidationError,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde_json::Value;

use super::GraphqlCalendarQuery;
use crate::{
    CalendarGraphqlContext,
    test_fixtures::{EVENT_ID, LINK_ID, timed_listing},
};

#[derive(Clone, Copy, Default)]
enum Failure {
    #[default]
    None,
    Validation,
    Internal,
}

#[derive(Default)]
struct FakeReads {
    listings: Vec<OccurrenceListing>,
    calendars: Vec<VisibleCalendar>,
    watermark: CalendarWatermark,
    changes: CalendarChangesPage,
    failure: Failure,
    requests: Mutex<Vec<(String, Option<CalendarOccurrenceCursor>, u16)>>,
    calls: Mutex<Vec<&'static str>>,
    since: Mutex<Vec<CalendarWatermark>>,
}

impl FakeReads {
    fn fail(&self) -> Result<(), Report> {
        match self.failure {
            Failure::None => Ok(()),
            Failure::Validation => {
                Err(rootcause::report!(CalendarValidationError::InvalidRange).into())
            }
            Failure::Internal => Err(rootcause::report!("database host db-7 refused").into()),
        }
    }
}

impl CalendarOccurrenceService for FakeReads {
    async fn list_occurrences(
        &self,
        requester_id: &str,
        _range: OccurrenceRange,
        cursor: Option<CalendarOccurrenceCursor>,
        limit: u16,
    ) -> Result<Vec<OccurrenceListing>, Report> {
        self.requests
            .lock()
            .unwrap()
            .push((requester_id.to_owned(), cursor, limit));
        self.calls.lock().unwrap().push("occurrences");
        self.fail()?;
        Ok(self
            .listings
            .iter()
            .take(usize::from(limit))
            .cloned()
            .collect())
    }

    async fn sync_status(&self, _requester_id: &str) -> Result<CalendarSyncStatus, Report> {
        Ok(CalendarSyncStatus::Syncing)
    }

    async fn list_visible_calendars(
        &self,
        requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, Report> {
        self.requests
            .lock()
            .unwrap()
            .push((requester_id.to_owned(), None, 0));
        self.fail()?;
        Ok(self.calendars.clone())
    }

    async fn mention_previews(
        &self,
        _requester_id: &str,
        _items: Vec<CalendarMentionRequestItem>,
    ) -> Result<Vec<CalendarMentionPreview>, Report> {
        unreachable!("calendar GraphQL reads never resolve mention previews")
    }

    async fn list_team_out_of_office(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _limit: u16,
    ) -> Result<Vec<TeamOutOfOffice>, Report> {
        unreachable!("calendar GraphQL reads never list team out-of-office")
    }

    async fn primary_time_zone(&self, _requester_id: &str) -> Result<Option<String>, Report> {
        unreachable!("calendar GraphQL reads never resolve the primary time zone")
    }
}

impl CalendarChangeQueryService for FakeReads {
    async fn current_watermark(&self, _viewer: &str) -> Result<CalendarWatermark, Report> {
        self.calls.lock().unwrap().push("watermark");
        Ok(self.watermark.clone())
    }

    async fn changes_since(
        &self,
        _viewer: &str,
        since: CalendarWatermark,
    ) -> Result<CalendarChangesPage, Report> {
        self.since.lock().unwrap().push(since);
        self.fail()?;
        Ok(self.changes.clone())
    }
    async fn event_change(
        &self,
        _viewer: &str,
        _event_id: uuid::Uuid,
    ) -> Result<Option<CalendarEventChange>, Report> {
        unreachable!("queries never read one event's committed state")
    }
}

const VIEWER: &str = "macro|viewer@example.com";

async fn execute(reads: Arc<FakeReads>, query: &str) -> async_graphql::Response {
    let schema = Schema::build(
        GraphqlCalendarQuery::new(MacroUserIdStr::parse_from_str(VIEWER).unwrap()),
        EmptyMutation,
        EmptySubscription,
    )
    .data(CalendarGraphqlContext::new(Arc::clone(&reads), reads))
    .finish();
    schema.execute(query).await
}

const PAGE_QUERY: &str = r#"{
    calendarOccurrences(input: {
        start: "2026-10-05T00:00:00Z", end: "2026-10-12T00:00:00Z", first: 2
    }) {
        nodes {
            __typename id eventId linkId occurrenceKey
            time { __typename ... on GraphqlTimedEventTime { startsAt endsAt } }
            event { __typename id linkId title }
        }
        hasNextPage endCursor syncStatus watermark { linkId seq }
    }
}"#;

#[tokio::test]
async fn a_full_page_reports_a_cursor_and_requests_one_extra_row() {
    let reads = Arc::new(FakeReads {
        listings: vec![timed_listing(6), timed_listing(7), timed_listing(8)],
        ..Default::default()
    });

    let response = execute(Arc::clone(&reads), PAGE_QUERY).await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let page = &data["calendarOccurrences"];
    let nodes = page["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 2);
    assert_eq!(nodes[0]["__typename"], "GraphqlCalendarOccurrence");
    assert_eq!(
        nodes[0]["id"],
        format!("{EVENT_ID}:2026-10-06T15:00:00+00:00")
    );
    assert_eq!(nodes[0]["eventId"], EVENT_ID.to_string());
    assert_eq!(nodes[0]["linkId"], LINK_ID.to_string());
    assert_eq!(nodes[0]["time"]["__typename"], "GraphqlTimedEventTime");
    assert_eq!(nodes[0]["event"]["__typename"], "GraphqlCalendarEvent");
    assert_eq!(nodes[0]["event"]["linkId"], LINK_ID.to_string());
    assert_eq!(page["hasNextPage"], true);
    assert_eq!(page["syncStatus"], "SYNCING");
    assert_eq!(page["watermark"], Value::Array(Vec::new()));
    assert_eq!(
        reads.calls.lock().unwrap()[..2],
        ["watermark", "occurrences"],
        "the watermark is captured before the page is read"
    );

    let cursor = page["endCursor"].as_str().unwrap().to_owned();
    let requests = reads.requests.lock().unwrap().clone();
    assert_eq!(requests, vec![(VIEWER.to_owned(), None, 3)]);

    let next = PAGE_QUERY.replace("first: 2", &format!("first: 2, after: \"{cursor}\""));
    let response = execute(Arc::clone(&reads), &next).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let requests = reads.requests.lock().unwrap().clone();
    let resumed = requests[1].1.as_ref().expect("decoded cursor");
    assert_eq!(resumed.event_id, EVENT_ID);
    assert_eq!(resumed.occurrence_key, "2026-10-07T15:00:00+00:00");
}

#[tokio::test]
async fn a_short_page_has_no_cursor() {
    let reads = Arc::new(FakeReads {
        listings: vec![timed_listing(6)],
        ..Default::default()
    });

    let response = execute(reads, PAGE_QUERY).await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["calendarOccurrences"]["hasNextPage"], false);
    assert_eq!(data["calendarOccurrences"]["endCursor"], Value::Null);
}

#[tokio::test]
async fn calendars_are_listed_for_the_viewer() {
    let reads = Arc::new(FakeReads {
        calendars: vec![VisibleCalendar {
            id: uuid::Uuid::from_u128(5),
            email_link_id: LINK_ID,
            email_address: "viewer@example.com".to_owned(),
            name: "Work".to_owned(),
            color: None,
            is_primary: true,
            is_writable: true,
            is_subscription: false,
            sync_error: None,
            default_reminders: Vec::new(),
        }],
        ..Default::default()
    });

    let response = execute(
        Arc::clone(&reads),
        "{ calendars { __typename id linkId name isWritable } }",
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["calendars"][0]["__typename"], "GraphqlCalendar");
    assert_eq!(data["calendars"][0]["linkId"], LINK_ID.to_string());
    assert_eq!(reads.requests.lock().unwrap()[0].0, VIEWER);
}

#[tokio::test]
async fn validation_failures_are_user_errors() {
    let reads = Arc::new(FakeReads {
        failure: Failure::Validation,
        ..Default::default()
    });

    let response = execute(reads, PAGE_QUERY).await;

    let error = &response.errors[0];
    assert!(error.message.contains("370 days"), "{}", error.message);
    assert_eq!(
        error
            .extensions
            .as_ref()
            .unwrap()
            .get("code")
            .unwrap()
            .to_string(),
        "\"BAD_USER_INPUT\""
    );
}

#[tokio::test]
async fn infrastructure_failures_are_masked() {
    let reads = Arc::new(FakeReads {
        failure: Failure::Internal,
        ..Default::default()
    });

    let occurrences = execute(Arc::clone(&reads), PAGE_QUERY).await;
    let calendars = execute(reads, "{ calendars { id } }").await;

    for (response, message) in [
        (occurrences, "calendar occurrences are unavailable"),
        (calendars, "calendars are unavailable"),
    ] {
        let error = &response.errors[0];
        assert_eq!(error.message, message);
        assert!(!error.message.contains("db-7"));
        assert_eq!(
            error
                .extensions
                .as_ref()
                .unwrap()
                .get("code")
                .unwrap()
                .to_string(),
            "\"INTERNAL_SERVER_ERROR\""
        );
    }
}

#[tokio::test]
async fn pages_report_the_watermark_as_decimal_strings() {
    let reads = Arc::new(FakeReads {
        listings: vec![timed_listing(6)],
        watermark: CalendarWatermark::from_links([CalendarLinkWatermark {
            link_id: LINK_ID,
            seq: 9_007_199_254_740_993,
        }]),
        ..Default::default()
    });

    let response = execute(reads, PAGE_QUERY).await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(
        data["calendarOccurrences"]["watermark"],
        serde_json::json!([{ "linkId": LINK_ID.to_string(), "seq": "9007199254740993" }])
    );
}

#[tokio::test]
async fn occurrences_of_one_event_share_the_series_event() {
    let reads = Arc::new(FakeReads {
        listings: vec![timed_listing(6), timed_listing(7)],
        ..Default::default()
    });

    let response = execute(reads, PAGE_QUERY).await;

    let data = response.data.into_json().unwrap();
    let nodes = data["calendarOccurrences"]["nodes"].as_array().unwrap();
    assert_eq!(nodes[0]["event"], nodes[1]["event"]);
}

const CHANGES_QUERY: &str = r#"{
    calendarChanges(input: { since: [{ linkId: "LINK", seq: "4" }] }) {
        events {
            event { __typename id linkId }
            occurrences { id eventId linkId event { id } }
        }
        deletedEventIds
        calendars { id }
        deletedCalendarIds
        newWatermark { linkId seq }
        hasMore
        resetRequired
    }
}"#;

fn changes_query() -> String {
    CHANGES_QUERY.replace("LINK", &LINK_ID.to_string())
}

#[tokio::test]
async fn changes_map_the_page_and_parse_the_watermark() {
    let listing = timed_listing(6);
    let deleted_event = uuid::Uuid::from_u128(0x99);
    let deleted_calendar = uuid::Uuid::from_u128(0x98);
    let reads = Arc::new(FakeReads {
        changes: CalendarChangesPage {
            events: vec![CalendarEventChange {
                event: listing.event.clone(),
                link_id: LINK_ID,
                occurrences: vec![EventOccurrence {
                    occurrence: listing.occurrence.clone(),
                    exception: listing.exception.clone(),
                }],
            }],
            deleted_event_ids: vec![deleted_event],
            calendars: Vec::new(),
            deleted_calendar_ids: vec![deleted_calendar],
            new_watermark: CalendarWatermark::from_links([CalendarLinkWatermark {
                link_id: LINK_ID,
                seq: 12,
            }]),
            has_more: true,
            reset_required: false,
        },
        ..Default::default()
    });

    let response = execute(Arc::clone(&reads), &changes_query()).await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    let changes = &data["calendarChanges"];
    assert_eq!(
        changes["events"][0]["event"]["__typename"],
        "GraphqlCalendarEvent"
    );
    assert_eq!(changes["events"][0]["event"]["id"], EVENT_ID.to_string());
    let occurrence = &changes["events"][0]["occurrences"][0];
    assert_eq!(
        occurrence["id"],
        format!("{EVENT_ID}:2026-10-06T15:00:00+00:00")
    );
    assert_eq!(occurrence["event"]["id"], EVENT_ID.to_string());
    assert_eq!(changes["deletedEventIds"][0], deleted_event.to_string());
    assert_eq!(
        changes["deletedCalendarIds"][0],
        deleted_calendar.to_string()
    );
    assert_eq!(
        changes["newWatermark"],
        serde_json::json!([{ "linkId": LINK_ID.to_string(), "seq": "12" }])
    );
    assert_eq!(changes["hasMore"], true);
    assert_eq!(changes["resetRequired"], false);
    assert_eq!(
        *reads.since.lock().unwrap(),
        vec![CalendarWatermark::from_links([CalendarLinkWatermark {
            link_id: LINK_ID,
            seq: 4,
        }])]
    );
}

#[tokio::test]
async fn a_malformed_watermark_is_a_user_error() {
    for since in [
        r#"[{ linkId: "not-a-uuid", seq: "1" }]"#.to_owned(),
        format!(r#"[{{ linkId: "{LINK_ID}", seq: "-1" }}]"#),
        format!(r#"[{{ linkId: "{LINK_ID}", seq: "one" }}]"#),
    ] {
        let reads = Arc::new(FakeReads::default());
        let response = execute(
            Arc::clone(&reads),
            &format!("{{ calendarChanges(input: {{ since: {since} }}) {{ hasMore }} }}"),
        )
        .await;

        assert_eq!(
            response.errors[0]
                .extensions
                .as_ref()
                .unwrap()
                .get("code")
                .unwrap()
                .to_string(),
            "\"BAD_USER_INPUT\"",
            "{since}"
        );
        assert!(reads.since.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn change_failures_are_masked() {
    let reads = Arc::new(FakeReads {
        failure: Failure::Internal,
        ..Default::default()
    });

    let response = execute(reads, &changes_query()).await;

    assert_eq!(
        response.errors[0].message,
        "calendar changes are unavailable"
    );
}
