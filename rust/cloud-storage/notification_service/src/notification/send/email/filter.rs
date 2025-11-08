use std::collections::HashMap;

use anyhow::Context;
use model_notifications::{NotificationEventType, NotificationWithRecipient};
use notification_db_client::user_notification::get::should_email::should_email_based_on_user_notification_bulk;

use crate::notification::{comms_utils, context::QueueWorkerContext};

pub async fn filter_emails(
    queue_worker_context: &QueueWorkerContext,
    notification: &NotificationWithRecipient,
    user_ids: &[String],
) -> anyhow::Result<Vec<String>> {
    // Filter out users that have already received an email for this event
    // This is done to prevent spam
    let should_email: HashMap<String, bool> =
        should_email(&queue_worker_context.db, notification, user_ids)
            .await
            .context("unable to get should email")?;
    tracing::debug!(should_email=?should_email, "got should email");

    // Filter only users that should receive an email
    let filtered_user_ids: Vec<String> = should_email
        .iter()
        .filter_map(|(user_id, should_email)| {
            if *should_email {
                Some(user_id.to_string())
            } else {
                None
            }
        })
        .collect();
    tracing::debug!(filtered_user_ids=?filtered_user_ids, "got filtered user ids");

    let emails: Vec<String> = filtered_user_ids
        .iter()
        .map(|user_id| user_id.replace("macro|", ""))
        .collect::<Vec<String>>();
    tracing::debug!(emails=?emails, "got emails to send emails to");

    // Filter only valid emails
    let emails: Vec<String> = emails
        .into_iter()
        .filter(|email| email_validator::is_valid_email(email))
        .collect();
    tracing::debug!(emails=?emails, "filtered valid emails");

    // Get unsubscribed status for emails
    let email_unsubscribed =
        notification_db_client::unsubscribe::email::is_email_unsubscribed_batch(
            &queue_worker_context.db,
            &emails,
        )
        .await
        .context("unable to check if emails are unsubscribed")?;
    tracing::debug!(email_unsubscribed=?email_unsubscribed, "got email unsubscribed");

    // Get a list of all matching emails that are subscribed
    let email: Vec<String> = email_unsubscribed
        .iter()
        .filter_map(|(email, is_unsubscribed)| {
            if *is_unsubscribed {
                None
            } else {
                Some(email.clone())
            }
        })
        .collect();
    tracing::debug!(emails=?emails, "filtered unsubscribed emails");

    let emails = filter_by_rate_limit(queue_worker_context, notification, &email).await?;
    tracing::debug!(emails=?emails, "filtered by rate limit");

    Ok(emails)
}

/// Given the notification and list of user ids to potentially send an email to, this will return
/// a map of each user id and whether or not they should receive an email.
async fn should_email(
    db: &sqlx::Pool<sqlx::Postgres>,
    notification: &NotificationWithRecipient,
    user_ids: &[String],
) -> anyhow::Result<HashMap<String, bool>> {
    match notification.inner.notification_event.event_type() {
        NotificationEventType::ItemSharedUser => {
            let result = should_email_based_on_user_notification_bulk(
                db,
                &notification.inner.notification_event.event_type(),
                &notification.inner.notification_entity.event_item_id,
                &notification
                    .inner
                    .notification_entity
                    .event_item_type
                    .to_string(),
                user_ids,
            )
            .await?;

            Ok(result.into_iter().collect())
        }
        NotificationEventType::ChannelInvite => comms_utils::should_email_channel_notification(
            db,
            &notification.inner.notification_entity.event_item_id,
            user_ids,
        )
        .await
        .context("unable to get should email channel notification"),
        _ => anyhow::bail!("unsupported notification event type"),
    }
}

/// Filters out emails by rate limit
/// We only allow 1 email per user per hour from another user
async fn filter_by_rate_limit(
    queue_worker_context: &QueueWorkerContext,
    notification: &NotificationWithRecipient,
    emails: &[String],
) -> anyhow::Result<Vec<String>> {
    match notification.inner.notification_event.event_type() {
        NotificationEventType::ChannelInvite => {
            let invited_by_email = notification
                .inner
                .sender_id
                .as_ref()
                .map(|sender_id| sender_id.replace("macro|", ""))
                .context("unable to get sender id")?;

            let channel_invited_rate_limit = queue_worker_context
                .macro_cache_client
                .get_channel_invited_rate_limit_bulk(emails, &invited_by_email)
                .await
                .context("unable to get channel invited rate limit")?;

            let valid_emails = emails
                .iter()
                .filter_map(|email| {
                    if let Some(email_rate_limit) = channel_invited_rate_limit.get(email) {
                        if let Some(rate_limit) = email_rate_limit
                            && *rate_limit >= 1
                        {
                            return None;
                        }
                        Some(email.to_string())
                    } else {
                        None
                    }
                })
                .collect();

            Ok(valid_emails)
        }
        _ => Ok(emails.to_vec()), // default to no filtering by rate limit
    }
}
