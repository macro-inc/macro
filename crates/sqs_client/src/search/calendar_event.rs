/// Requests calendar event reconciliation through the search queue.
///
/// Calendar has no Kafka topic, so unlike projects this is the live path as
/// well as the backfill one: every write funnels through
/// `CalendarRepository::upsert_event`, which enqueues one of these.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct UpsertCalendarEvent {
    /// The calendar event entity id
    pub event_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}

/// Removes a calendar event from the search index.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct RemoveCalendarEvent {
    /// The calendar event entity id
    pub event_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
