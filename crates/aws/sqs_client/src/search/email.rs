#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EmailThreadBatchMessage {
    /// The thread ids to process
    pub thread_ids: Vec<String>,
    /// The macro user id of the user who the messages are for
    pub macro_user_id: String,
    /// Optional override for the target OpenSearch index
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_override: Option<String>,
}
