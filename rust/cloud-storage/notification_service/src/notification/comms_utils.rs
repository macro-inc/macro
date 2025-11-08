use anyhow::Context;
use std::collections::HashMap;

/// Returns a map of user ids to a boolean indicating if we should email the user or not.
pub(in crate::notification) async fn should_email_channel_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<HashMap<String, bool>> {
    let channel_notification_email_sent = notification_db_client::channel_notification_email_sent::get::get_channel_notification_email_sent_bulk(
        db,
        channel_id,
        user_ids,
    )
    .await.context("unable to get channel notification email sent")?;

    tracing::debug!(channel_notification_email_sent=?channel_notification_email_sent, "got channel notification email sent");

    let mut should_email = HashMap::new();

    // If the user does not have a channel_notificaiton_email_sent record, we should email them.
    for user_id in user_ids {
        // If the user has not received an email notification for this channel, we should email them.
        if !channel_notification_email_sent.contains_key(user_id) {
            should_email.insert(user_id.clone(), true);
            continue;
        }
    }

    Ok(should_email)
}
