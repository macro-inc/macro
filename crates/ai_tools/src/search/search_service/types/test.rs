use super::*;
use models_search::calendar_event::{
    CalendarEventMetadata, CalendarEventSearchResponseItem,
    CalendarEventSearchResponseItemWithMetadata, CalendarEventSearchRole, CalendarEventSearchTime,
};

#[test]
fn searches_include_sessions_by_default_and_never_include_legacy_chats() {
    let filters = search_filters(&[], item_filters::EntityFilters::default());
    assert!(filters.agent_session_filters.include);
    assert_eq!(
        filters.chat_filters.chat_ids,
        vec![uuid::Uuid::nil().to_string()]
    );
    let filters = search_filters(
        &[SearchEntityType::AgentSessions],
        item_filters::EntityFilters::default(),
    );
    assert!(filters.agent_session_filters.include);
    assert_eq!(
        filters.document_filters.document_ids,
        vec![uuid::Uuid::nil().to_string()]
    );
    assert!(serde_json::from_str::<SearchEntityType>("\"chats\"").is_err());
}

fn calendar_hit(
    contributes_to_availability: Option<bool>,
    role: Option<CalendarEventSearchRole>,
) -> UnifiedSearchResponseItem {
    let at = chrono::DateTime::UNIX_EPOCH;
    UnifiedSearchResponseItem::CalendarEvent(CalendarEventSearchResponseItemWithMetadata {
        metadata: Some(CalendarEventMetadata {
            created_at: at,
            updated_at: at,
            status: "confirmed".to_string(),
            time: CalendarEventSearchTime::Timed {
                starts_at: at,
                ends_at: at,
                time_zone: None,
            },
            is_recurring: false,
            occurrence: None,
            conference_url: None,
            is_read_only: false,
            organizer: None,
            calendar_name: contributes_to_availability.map(|_| "colleague@example.com".to_string()),
            contributes_to_availability,
            inbox: None,
            role,
            description: None,
        }),
        properties: None,
        extra: CalendarEventSearchResponseItem {
            id: uuid::Uuid::nil(),
            name: "Dentist".to_string(),
            owner_id: "macro|owner@example.com".to_string(),
            updated_at: at,
            created_at: at,
            calendar_event_search_results: Vec::new(),
        },
    })
}

/// Models answered "your appointment" from the row's fields and never from
/// this sentence, so a result that is not the user's has to carry it.
#[test]
fn a_result_off_the_schedule_says_so_in_plain_words() {
    let summary = calendar_event_summary(&calendar_hit(Some(false), None)).expect("a summary");
    assert!(
        summary.starts_with("Dentist is on colleague@example.com,"),
        "{summary}"
    );
    assert!(summary.contains("not part of their schedule"), "{summary}");
}

#[test]
fn a_result_that_is_the_users_needs_no_summary() {
    assert_eq!(
        calendar_event_summary(&calendar_hit(Some(true), None)),
        None
    );
    for role in [
        CalendarEventSearchRole::Organizer,
        CalendarEventSearchRole::Guest,
    ] {
        assert_eq!(
            calendar_event_summary(&calendar_hit(Some(false), Some(role))),
            None,
            "they attend it wherever the copy sits"
        );
    }
}

/// A label read can fail, and a channel share is on none of the user's
/// calendars: neither may read as someone else's calendar.
#[test]
fn missing_labels_are_not_read_as_a_negative() {
    assert_eq!(calendar_event_summary(&calendar_hit(None, None)), None);
}

#[test]
fn the_summary_sits_beside_the_result_and_stays_off_when_absent() {
    let item = SessionAwareSearchResult::from_unified(calendar_hit(Some(false), None))
        .expect("a calendar result");
    let row = serde_json::to_value(TaggedSessionAwareSearchResult {
        item,
        tags: Vec::new(),
        summary: Some("Dentist is on a calendar.".to_string()),
    })
    .expect("serializes");
    assert_eq!(row["summary"], "Dentist is on a calendar.");
    assert_eq!(row["type"], "calendarEvent");

    let item = SessionAwareSearchResult::from_unified(calendar_hit(Some(true), None))
        .expect("a calendar result");
    let row = serde_json::to_value(TaggedSessionAwareSearchResult {
        item,
        tags: Vec::new(),
        summary: None,
    })
    .expect("serializes");
    assert!(row.get("summary").is_none());
}
