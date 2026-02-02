use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata,
    DocumentMentionMetadata, InviteToTeamMetadata, NewEmailMetadata, TaskAssignedMetadata,
};
use ::notification::domain::models::UserNotificationRow;
use serde::{Deserialize, Serialize};

/// Mirrors [`model_notifications::NotificationEvent`] but uses `tag` / `content`
/// as the serde adjacently-tagged field names so it can be deserialized from the
/// shape produced by [`UserNotificationRow::into_tagged`] +
/// [`UserNotificationRow::into_json`].
///
/// Only includes variants whose metadata types implement the `Notification` trait.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "tag", content = "content", rename_all = "snake_case")]
pub enum NotifEvent {
    /// Someone mentioned you in a channel.
    ChannelMention(ChannelMentionMetadata),
    /// Someone mentioned you in a document.
    DocumentMention(DocumentMentionMetadata),
    /// The user was invited to a channel.
    ChannelInvite(ChannelInviteMetadata),
    /// A user sent a message in a channel.
    ChannelMessageSend(ChannelMessageSendMetadata),
    /// Someone replied to a thread in a channel that the user is part of.
    ChannelMessageReply(ChannelReplyMetadata),
    /// A new email has been sent to the user.
    NewEmail(NewEmailMetadata),
    /// A user was invited to a team.
    InviteToTeam(InviteToTeamMetadata),
    /// A user was assigned to a task.
    TaskAssigned(TaskAssignedMetadata),
}

/// The strongly typed response for listing user notifications.
#[derive(Debug, Serialize)]
pub struct GetAllUserNotificationsResponse {
    /// The list of items returned.
    pub items: Vec<UserNotificationRow<NotifEvent>>,
    /// The next page cursor if it exists.
    pub next_cursor: Option<String>,
}

/// Convert a [`UserNotificationRow<serde_json::Value>`] into a
/// [`UserNotificationRow<NotifEvent>`] by tagging and deserializing the metadata.
pub fn to_typed_row(
    row: UserNotificationRow<serde_json::Value>,
) -> Result<UserNotificationRow<NotifEvent>, serde_json::Error> {
    row.into_tagged().into_json()?.deserialize_json::<NotifEvent>()
}

/// Build the strongly typed router that wraps the notification crate's generic router.
pub fn router<S: ::notification::domain::service::NotificationIngress, O: Clone + Send + Sync + 'static>(
    state: ::notification::inbound::http::NotificationRouterState<S>,
) -> axum::Router<O> {
    ::notification::inbound::http::router::<S, serde_json::Value, O>(state)
}
