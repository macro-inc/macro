/// Requests calendar event reconciliation.
///
/// Live changes arrive on the `macro.calendar` Kafka topic; this payload backs
/// the SQS backfill path, which can also retarget an alternate OpenSearch
/// index through `index_override`. Both paths converge on the same
/// reconciliation, which re-reads the row.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct UpsertCalendarEvent {
    /// The calendar event entity id
    pub event_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
