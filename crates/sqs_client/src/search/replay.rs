/// A broker event the search indexer failed to apply, queued to be applied
/// again from its original record.
#[derive(serde::Serialize, serde::Deserialize, Debug, PartialEq, Eq)]
pub struct ReplayBrokerEvent {
    /// The event's id, unique per event.
    pub event_id: String,
    /// The topic the record was read from.
    pub topic: String,
    pub partition: i32,
    pub offset: i64,
    /// The record's key.
    pub key: String,
    /// The record's payload: the event's JSON envelope.
    pub payload: String,
    /// When the broker recorded the event, in Unix milliseconds, so a replay's
    /// lag counts from the original change.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub produced_at_ms: Option<i64>,
    /// Attempts the indexer made before queueing the replay.
    pub attempts: u32,
    /// Why the last of those attempts failed.
    pub failure: String,
    /// W3C context of the processing that failed, so the replay joins its trace.
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub traceparent: Option<String>,
}

#[cfg(test)]
mod test;
