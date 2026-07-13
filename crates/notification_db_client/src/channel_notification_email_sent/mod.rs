pub mod delete;
pub mod get;
pub mod upsert;

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct ChannelNotificationEmailSent {
    /// The id of the channel
    pub channel_id: String,
    /// The id of the user
    pub user_id: String,
    /// The time the email was sent
    pub created_at: chrono::NaiveDateTime,
}
