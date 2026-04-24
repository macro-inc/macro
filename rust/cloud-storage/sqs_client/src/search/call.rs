/// (Re)index a call record.
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct CallRecordMessage {
    pub call_id: String,
}

/// Remove a call record (or every call for a channel when `call_id` is None).
#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct RemoveCallRecord {
    pub channel_id: String,
    pub call_id: Option<String>,
}
