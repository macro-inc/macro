use super::*;
use crate::domain::join_requests::CalendarJoinRequestStatus;
use crate::domain::models::{
    CalendarMentionEvent, CalendarMentionPreview, CalendarMentionRequestItem,
    CalendarMentionViewerCopy, EventTime,
};

/// Resolves every mention to `preview` and records what was asked for.
struct PreviewOccurrences {
    preview: CalendarMentionPreview,
    requested: Mutex<Vec<CalendarMentionRequestItem>>,
}

impl CalendarOccurrenceService for PreviewOccurrences {
    async fn list_occurrences(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _cursor: Option<crate::domain::models::CalendarOccurrenceCursor>,
        _limit: u16,
    ) -> Result<Vec<crate::domain::models::OccurrenceListing>, rootcause::Report> {
        unreachable!("reading an event lists no occurrences")
    }

    async fn sync_status(
        &self,
        _requester_id: &str,
    ) -> Result<CalendarSyncStatus, rootcause::Report> {
        unreachable!("reading an event checks no sync status")
    }

    async fn list_visible_calendars(
        &self,
        _requester_id: &str,
    ) -> Result<Vec<VisibleCalendar>, rootcause::Report> {
        unreachable!("reading an event lists no calendars")
    }

    async fn mention_previews(
        &self,
        _requester_id: &str,
        items: Vec<CalendarMentionRequestItem>,
    ) -> Result<Vec<CalendarMentionPreview>, rootcause::Report> {
        let previews = items.iter().map(|_| self.preview.clone()).collect();
        self.requested.lock().unwrap().extend(items);
        Ok(previews)
    }

    async fn list_team_out_of_office(
        &self,
        _requester_id: &str,
        _range: OccurrenceRange,
        _limit: u16,
    ) -> Result<Vec<crate::domain::models::TeamOutOfOffice>, rootcause::Report> {
        unreachable!("reading an event lists no team out-of-office")
    }

    async fn primary_time_zone(
        &self,
        _requester_id: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        unreachable!("reading an event resolves no time zone")
    }

    async fn meeting_copies(
        &self,
        _requester_id: &str,
        _event_id: uuid::Uuid,
    ) -> Result<Vec<crate::domain::models::MeetingCopy>, rootcause::Report> {
        unreachable!("reading an event lists no copies")
    }

    async fn event_ics(
        &self,
        _requester_id: &str,
        _event_id: Uuid,
    ) -> Result<Option<crate::domain::ics::CalendarEventIcs>, rootcause::Report> {
        unreachable!("reading an event exports nothing")
    }
}

fn mention(viewer_event_id: Option<Uuid>) -> CalendarMentionEvent {
    CalendarMentionEvent {
        viewer_event_id,
        viewer_copy: viewer_event_id.map(|_| CalendarMentionViewerCopy::Event),
        viewer_calendar_ids: viewer_event_id
            .map(|_| Uuid::from_u128(9))
            .into_iter()
            .collect(),
        title: "Design review".to_string(),
        description: Some("Walk through the rollout.".to_string()),
        time: EventTime::Timed {
            starts_at: Utc.with_ymd_and_hms(2026, 10, 26, 14, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2026, 10, 26, 14, 30, 0).unwrap(),
            time_zone: Some("America/New_York".to_string()),
        },
        occurrence_key: None,
        is_recurring: false,
        location: Some("Room 4".to_string()),
        organizer_email: Some("organizer@example.com".to_string()),
        organizer_name: Some("Organizer".to_string()),
        attendee_count: 1,
        updated_at: Utc.with_ymd_and_hms(2026, 10, 23, 12, 0, 0).unwrap(),
        can_request_to_join: false,
        join_request_status: None,
    }
}

async fn read(
    preview: CalendarMentionPreview,
    args: serde_json::Value,
) -> (
    ai_toolset::ToolResult<serde_json::Value>,
    Vec<CalendarMentionRequestItem>,
) {
    let own = visible_calendar(9, 1, "gab@example.com", "gab@example.com");
    read_with_calendar(preview, args, own).await
}

async fn read_with_calendar(
    preview: CalendarMentionPreview,
    args: serde_json::Value,
    calendar: VisibleCalendar,
) -> (
    ai_toolset::ToolResult<serde_json::Value>,
    Vec<CalendarMentionRequestItem>,
) {
    let occurrences = std::sync::Arc::new(PreviewOccurrences {
        preview,
        requested: Mutex::new(Vec::new()),
    });
    let context = CalendarToolContext::new(
        std::sync::Arc::new(MockMutations {
            calendars: Mutex::new(vec![calendar]),
            ..Default::default()
        }),
        occurrences.clone(),
        std::sync::Arc::new(MockMeetingLinks::default()),
    );
    let result = calendar_toolset()
        .try_tool_call(context, request_context(), "ReadCalendarEvent", &args)
        .await
        .unwrap();
    let requested = occurrences.requested.lock().unwrap().clone();
    (result, requested)
}

#[tokio::test]
async fn a_channel_shared_event_reads_as_shared_with_its_join_state() {
    let shared = Uuid::from_u128(41);
    let mut event = mention(None);
    event.can_request_to_join = true;
    event.join_request_status = Some(CalendarJoinRequestStatus::Pending);
    event.occurrence_key = Some("2026-10-26T14:00:00+00:00".to_string());

    let (result, requested) = read(
        CalendarMentionPreview::Accessible(Box::new(event)),
        serde_json::json!({
            "eventId": shared,
            "occurrenceKey": "2026-10-26T14:00:00+00:00",
        }),
    )
    .await;

    let read = result.unwrap();
    assert_eq!(read["access"], "shared_with_you");
    assert_eq!(read["eventId"], serde_json::Value::Null);
    assert_eq!(read["title"], "Design review");
    assert_eq!(read["start"], "2026-10-26T14:00:00+00:00");
    assert_eq!(read["organizerEmail"], "organizer@example.com");
    assert_eq!(read["attendeeCount"], 1);
    assert_eq!(read["canRequestToJoin"], true);
    assert_eq!(read["joinRequestStatus"], "pending");
    assert_eq!(read["recurrenceId"], "2026-10-26T14:00:00+00:00");
    assert_eq!(
        requested,
        vec![CalendarMentionRequestItem {
            event_id: shared,
            occurrence_key: Some("2026-10-26T14:00:00+00:00".to_string()),
        }]
    );
}

#[tokio::test]
async fn an_event_on_the_users_calendar_reads_with_their_own_copy() {
    let own_copy = Uuid::from_u128(42);

    let (result, _) = read(
        CalendarMentionPreview::Accessible(Box::new(mention(Some(own_copy)))),
        serde_json::json!({ "eventId": Uuid::from_u128(43), "occurrenceKey": null }),
    )
    .await;

    let read = result.unwrap();
    assert_eq!(read["access"], "on_your_calendar");
    assert_eq!(read["eventId"], own_copy.to_string());
    assert!(read.get("joinRequestStatus").is_none());
}

#[tokio::test]
async fn an_event_on_a_colleagues_calendar_never_reads_as_the_users() {
    let copy = Uuid::from_u128(42);
    let mut shared = visible_calendar(9, 1, "gab@example.com", "colleague@example.com");
    shared.contributes_to_availability = false;

    let (result, _) = read_with_calendar(
        CalendarMentionPreview::Accessible(Box::new(mention(Some(copy)))),
        serde_json::json!({ "eventId": copy, "occurrenceKey": null }),
        shared,
    )
    .await;

    let read = result.unwrap();
    assert_eq!(read["access"], "on_visible_calendar");
    assert_eq!(read["calendarName"], "colleague@example.com");
    assert_eq!(read["eventId"], copy.to_string());
    assert_eq!(
        read["summary"],
        "Design review is on colleague@example.com, which the user can see but which is not \
         part of their schedule and may be someone else's."
    );
}

/// Availability counts each copy, so a copy on the user's schedule makes the
/// event theirs even when the canonical copy's calendar does not contribute.
#[tokio::test]
async fn any_copy_on_the_schedule_makes_an_event_the_users() {
    let copy = Uuid::from_u128(42);
    let mut event = mention(Some(copy));
    event.viewer_calendar_ids = vec![Uuid::from_u128(8), Uuid::from_u128(9)];

    let (result, _) = read_with_calendar(
        CalendarMentionPreview::Accessible(Box::new(event)),
        serde_json::json!({ "eventId": copy, "occurrenceKey": null }),
        visible_calendar(9, 1, "gab@example.com", "Personal"),
    )
    .await;

    assert_eq!(result.unwrap()["access"], "on_your_calendar");
}

#[tokio::test]
async fn a_copy_reads_the_way_the_card_names_it() {
    for (copy, access) in [
        (CalendarMentionViewerCopy::Invitation, "invited"),
        (CalendarMentionViewerCopy::Snapshot, "snapshot"),
    ] {
        let mut event = mention(Some(Uuid::from_u128(45)));
        event.viewer_copy = Some(copy);

        let (result, _) = read(
            CalendarMentionPreview::Accessible(Box::new(event)),
            serde_json::json!({ "eventId": Uuid::from_u128(46), "occurrenceKey": null }),
        )
        .await;

        let read = result.unwrap();
        assert_eq!(read["access"], access);
        assert_eq!(read["eventId"], Uuid::from_u128(45).to_string());
    }
}

#[tokio::test]
async fn an_unreadable_event_says_why() {
    let args = serde_json::json!({ "eventId": Uuid::from_u128(44), "occurrenceKey": null });

    let (hidden, _) = read(CalendarMentionPreview::NoAccess, args.clone()).await;
    let (gone, _) = read(CalendarMentionPreview::DoesNotExist, args).await;

    assert!(hidden.unwrap_err().description.contains("cannot see it"));
    assert!(gone.unwrap_err().description.contains("no longer exists"));
}
