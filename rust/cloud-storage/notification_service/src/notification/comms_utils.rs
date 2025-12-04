use anyhow::Context;
use std::collections::HashSet;

/// Returns a list of user ids that should be emailed.
pub(in crate::notification) async fn should_email_channel_notification(
    auth_service_client: &authentication_service_client::AuthServiceClient,
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: &str,
    user_ids: &[String],
) -> anyhow::Result<HashSet<String>> {
    // We only want to send channel notification emails to **non-macro** users.
    let existing_users: HashSet<String> = auth_service_client.get_existing_users(user_ids).await?;

    // Filter out the list of user ids to only include users that are not macro users
    let filtered_user_ids: Vec<String> = user_ids
        .iter()
        .filter_map(|user_id| {
            if existing_users.contains(user_id) {
                None
            } else {
                Some(user_id.to_string())
            }
        })
        .collect();

    let channel_notification_email_sent = notification_db_client::channel_notification_email_sent::get::get_channel_notification_email_sent_bulk(
        db,
        channel_id,
        filtered_user_ids.as_slice(),
    )
    .await.context("unable to get channel notification email sent")?;

    tracing::debug!(channel_notification_email_sent=?channel_notification_email_sent, "got channel notification email sent");

    let mut should_email = HashSet::new();

    // If the user does not have a channel_notificaiton_email_sent record, we should email them.
    for user_id in user_ids {
        // If the user has not received an email notification for this channel, we should email them.
        if !channel_notification_email_sent.contains_key(user_id) {
            should_email.insert(user_id.clone());
            continue;
        }
    }

    Ok(should_email)
}
