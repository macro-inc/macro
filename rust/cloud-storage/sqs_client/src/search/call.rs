/// Message used to request (re)indexing of a single call record by id.
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct CallRecordMessage {
    /// The call record id to index
    pub call_id: String,
}

/// Message used to request removal of a call record from the index.
/// If `call_id` is `None`, all call records for the given channel are removed.
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct RemoveCallRecord {
    /// The channel id the call belongs to
    pub channel_id: String,
    /// The call record id to remove; if `None`, removes every call record for `channel_id`
    pub call_id: Option<String>,
}
