use super::*;
use crate::domain::models::{CalendarCapabilities, CalendarProvider};

const SHARED_EVENT: Uuid = Uuid::from_u128(77);

async fn add(
    calendars: Vec<VisibleCalendar>,
    copy_error: Option<CalendarMutationError>,
    shared_event_copies: bool,
    args: serde_json::Value,
) -> (
    ai_toolset::ToolResult<serde_json::Value>,
    Vec<(Uuid, Option<Uuid>)>,
) {
    let (mutations, context) = context(
        MockMutations {
            calendars: Mutex::new(calendars),
            copy_error: Mutex::new(copy_error),
            ..Default::default()
        },
        empty_occurrences(),
    );
    let result = calendar_toolset()
        .try_tool_call(
            context.0.with_shared_event_copies(shared_event_copies),
            request_context(),
            "AddSharedCalendarEvent",
            &args,
        )
        .await
        .unwrap();
    let copied = mutations.copied.lock().unwrap().clone();
    (result, copied)
}

fn args(calendar_id: Option<Uuid>) -> serde_json::Value {
    serde_json::json!({ "eventId": SHARED_EVENT, "calendarId": calendar_id })
}

/// Calendars the card does not offer: Outlook, a read-only Google calendar
/// and a subscribed one.
fn calendars_without_copies() -> Vec<VisibleCalendar> {
    let mut outlook = visible_calendar(20, 21, "gab@outlook.example", "Outlook");
    outlook.provider = CalendarProvider::Outlook;
    outlook.capabilities = CalendarCapabilities::outlook(true);
    let mut read_only = visible_calendar(22, 4, "gab@example.com", "Team");
    read_only.is_writable = false;
    let mut holidays = visible_calendar(23, 4, "gab@example.com", "Holidays");
    holidays.is_subscription = true;
    vec![outlook, read_only, holidays]
}

#[tokio::test]
async fn adds_the_copy_to_the_only_calendar_the_card_offers() {
    let mut calendars = calendars_without_copies();
    calendars.push(visible_calendar(9, 4, "gab@example.com", "Work"));

    let (result, copied) = add(calendars, None, true, args(None)).await;

    let copy = result.unwrap();
    assert_eq!(copied, vec![(SHARED_EVENT, Some(Uuid::from_u128(9)))]);
    assert_eq!(copy["eventId"], Uuid::from_u128(7).to_string());
    assert_eq!(copy["calendarName"], "Work");
    assert_eq!(copy["inbox"], "gab@example.com");
}

#[tokio::test]
async fn asks_which_calendar_when_several_take_copies() {
    let calendars = vec![
        visible_calendar(9, 4, "gab@example.com", "Work"),
        visible_calendar(10, 5, "gab@other.example", "Personal"),
    ];

    let (result, copied) = add(calendars, None, true, args(None)).await;

    let error = result.unwrap_err();
    assert!(copied.is_empty());
    assert!(error.description.contains("Ask which one"));
    assert!(error.description.contains(&Uuid::from_u128(9).to_string()));
    assert!(error.description.contains(&Uuid::from_u128(10).to_string()));
    assert!(!error.description.contains("@"));
}

#[tokio::test]
async fn adds_the_copy_to_the_named_calendar() {
    let calendars = vec![
        visible_calendar(9, 4, "gab@example.com", "Work"),
        visible_calendar(10, 5, "gab@other.example", "Personal"),
    ];

    let (result, copied) = add(calendars, None, true, args(Some(Uuid::from_u128(10)))).await;

    result.unwrap();
    assert_eq!(copied, vec![(SHARED_EVENT, Some(Uuid::from_u128(10)))]);
}

#[tokio::test]
async fn refuses_a_named_calendar_the_card_does_not_offer() {
    let mut calendars = calendars_without_copies();
    calendars.push(visible_calendar(9, 4, "gab@example.com", "Work"));

    // Outlook, read-only and subscribed.
    for named in [20, 22, 23].map(Uuid::from_u128) {
        let (result, copied) = add(calendars.clone(), None, true, args(Some(named))).await;

        assert!(copied.is_empty());
        assert!(
            result
                .unwrap_err()
                .description
                .contains("can't take a copy")
        );
    }
}

#[tokio::test]
async fn points_to_the_ics_file_when_no_calendar_takes_copies() {
    let (result, copied) = add(calendars_without_copies(), None, true, args(None)).await;

    assert!(copied.is_empty());
    assert!(result.unwrap_err().description.contains(".ics"));
}

#[tokio::test]
async fn says_why_the_server_refused_the_copy() {
    let calendars = vec![visible_calendar(9, 4, "gab@example.com", "Work")];

    let (result, _) = add(
        calendars,
        Some(CalendarMutationError::JoinRequestOpen),
        true,
        args(None),
    )
    .await;

    assert!(
        result
            .unwrap_err()
            .description
            .contains("asked the person who shared this event")
    );
}

#[tokio::test]
async fn adds_nothing_while_the_deployment_switch_is_off() {
    let calendars = vec![visible_calendar(9, 4, "gab@example.com", "Work")];

    let (result, copied) = add(calendars, None, false, args(None)).await;

    assert!(copied.is_empty());
    assert!(result.unwrap_err().description.contains("not enabled"));
}
