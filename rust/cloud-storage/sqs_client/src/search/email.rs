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
}

#[derive(serde::Serialize, serde::Deserialize, PartialEq, Eq, Debug)]
pub struct EmailLinkMessage {
    /// The link id
    pub link_id: String,
    /// The macro user id associated with the link
    pub macro_user_id: String,
}
