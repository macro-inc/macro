#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct CallRecordMessage {
    pub call_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct RemoveCallRecord {
    pub channel_id: String,
    /// `None` removes every call record for `channel_id`.
    pub call_id: Option<String>,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub index_override: Option<String>,
}
