mod filter;
mod template;

use anyhow::Context;
use filter::filter_emails;
use futures::StreamExt;
use macro_env::Environment;
use model_notifications::{NotificationEventType, NotificationWithRecipient};

use crate::{env::SENDER_ADDRESS, notification::context::QueueWorkerContext};

/// Given a notification and list of user ids, this will send any necessary emails to the user.
/// This is used for *immediate* notifications, such as when a user is added to a channel.
/// This is not meant to be used for notifications that are polled such as when a user is sent
/// messages.
pub async fn process_email_notifications(
    queue_worker_context: &QueueWorkerContext,
    notification: &NotificationWithRecipient,
    user_ids: &[String],
) -> anyhow::Result<()> {
    let user_ids = user_ids
        .iter()
        .map(|user_id| user_id.to_string())
        .collect::<Vec<String>>();
    // Only include valid events we want to send emails for
    match notification.inner.notification_event.event_type() {
        // NotificationEventType::CloudStorageItemSharedUser => {}
        NotificationEventType::ChannelInvite => {}
        // NotificationEventType::ChannelMessageSend => {}
        _ => return Ok(()),
    }
    tracing::trace!("sending email notifications");

    // For NON-PROD: Only send emails if the sender is a macro employee
    match Environment::new_or_prod() {
        Environment::Develop | Environment::Local => {
            let sender_id = notification.inner.sender_id.clone();

            if sender_id.is_none() {
                tracing::info!("not sending notification emails for anonymous users");
                return Ok(());
            }

            if !sender_id.unwrap().ends_with("@macro.com") {
                tracing::info!(
                    "not sending notification emails for non-macro users in non-prod environment"
                );
                return Ok(());
            }
        }
        Environment::Production => (),
    }

    let sender_address = &*SENDER_ADDRESS;

    let emails = filter_emails(queue_worker_context, notification, &user_ids).await?;

    if emails.is_empty() {
        tracing::info!("no valid emails to send emails to");
        return Ok(());
    }

    let channel_invite_sent_user_ids = emails
        .iter()
        .map(|e| format!("macro|{}", e))
        .collect::<Vec<String>>();

    // For channel invites we want to make sure we set the email sent status for the channel ASAP
    if notification.inner.notification_event.event_type() == NotificationEventType::ChannelInvite {
        tracing::trace!("upserting channel notification email sent");
        let sender_email = notification
            .inner
            .sender_id
            .as_ref()
            .map(|s| s.replace("macro|", ""))
            .context("sender id should exist")?;

        notification_db_client::channel_notification_email_sent::upsert::upsert_channel_notification_email_sent_bulk(
                &queue_worker_context.db,
                &notification.inner.notification_entity.event_item_id,
                &channel_invite_sent_user_ids,
            )
            .await.context("unable to upsert channel notification email sent")?;

        queue_worker_context
            .macro_cache_client
            .increment_channel_invited_rate_limit_bulk(
                &emails,
                &sender_email,
                3600, // 1 hour
            )
            .await
            .context("unable to increment channel invited rate limit")?;
    }

    let (email_content, subject) =
        crate::notification::send::email::template::fill_email_template(notification)
            .context("unable to fill email template")?;

    tracing::info!(num_email=%emails.len(), emails=?emails, "notification_service_email_send");

    let result = futures::stream::iter(emails.iter())
        .then(|email| {
            let ses_client = queue_worker_context.ses_client.clone();
            let email_content = email_content.clone();
            let subject = subject.clone();
            async move {
                tracing::debug!(email=?email, "sending email");

                ses_client
                    .send_email(sender_address, email, &subject, &email_content)
                    .await
                    .context("unable to send email")?;

                Ok(())
            }
        })
        .collect::<Vec<anyhow::Result<()>>>()
        .await;

    result.iter().filter(|r| r.is_err()).for_each(|r| {
        tracing::error!(error=?r, "unable to send email");
    });

    Ok(())
}
