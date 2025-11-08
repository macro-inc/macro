use anyhow::Context;
use model_notifications::{Notification, RawNotification};

/// Creates the notification and all user_notifications
/// Returns the notification if the creation is successful
/// Returns None if the notification already exists
/// Returns an error if the creation fails
pub async fn create_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification: Notification,
    user_ids: &[String],
    is_important_v0: bool,
) -> anyhow::Result<Option<Notification>> {
    let mut notification_transaction = db
        .begin()
        .await
        .context("unable to begin notification_transaction")?;

    let notification =
        match notification_db_client::notification::create::create_notification_transaction(
            &mut notification_transaction,
            RawNotification::from(notification),
        )
        .await
        {
            Ok(notification) => notification,
            Err(e) => {
                // If the notification already exists, we can assume the message was processed
                if e.to_string().contains(
                    "duplicate key value violates unique constraint \"notification_pkey\"",
                ) {
                    return Ok(None);
                }

                anyhow::bail!(e)
            }
        };

    tracing::trace!(notification=?notification, "created notification");

    // There are no users to notify, we can skip the notification
    notification_db_client::user_notification::create::create_bulk_user_notifications(
        &mut notification_transaction,
        &notification.id,
        user_ids,
        is_important_v0,
    )
    .await?;

    tracing::trace!(notification=?notification, "created user notifications");

    notification_transaction.commit().await.inspect_err(|e| {
        tracing::error!(error=?e, "failed to commit notification_transaction");
    })?;

    Ok(Some(Notification::try_from(notification)?))
}
