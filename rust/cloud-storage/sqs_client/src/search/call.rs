#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct CallRecordMessage {
    pub call_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct RemoveCallRecord {
    pub channel_id: String,
    /// `None` removes every call record for `channel_id`.
    pub call_id: Option<String>,
}
