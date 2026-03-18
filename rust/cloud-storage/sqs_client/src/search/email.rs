#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EmailMessage {
    /// The message id
    pub message_id: String,
    /// The macro user id of the user who the message is for
    pub macro_user_id: String,
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EmailThreadMessage {
    /// The thread id
    pub thread_id: String,
    /// The macro user id of the user who the message is for
    pub macro_user_id: String,
    /// Optional override for the target OpenSearch index (e.g. "emails_v2" for migration backfills)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub index_override: Option<String>,
}

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

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EmailLinkMessage {
    /// The link id
    pub link_id: String,
    /// The macro user id associated with the link
    pub macro_user_id: String,
}
