use std::collections::HashSet;

use super::context::QueueWorkerContext;
use crate::notification::create::create_notification;
use crate::notification::user_data::populate_user_data;
use crate::notification::user_ids::utils::filter_sender_id_from_recipient_ids;
use crate::notification::{rate_limit, send};
use anyhow::Context;
use futures::StreamExt;
use model_notifications::{Notification, NotificationEventType, NotificationQueueMessage};

/// Processes a message from the notification queue.
/// If the processing  is successful, the message is deleted.
#[tracing::instrument(skip(ctx, message), fields(message_id=message.message_id))]
pub(crate) async fn process_message(
    ctx: QueueWorkerContext,
    message: &aws_sdk_sqs::types::Message,
) -> anyhow::Result<()> {
    let original_start_time = std::time::Instant::now();

    let (notification_id, notification_event_type, service_sender) = if let Some(attributes) =
        message.message_attributes.as_ref()
    {
        // Make Notification from message
        let notification_id = attributes.get("notification_id").map(|notification_id| {
            tracing::trace!(notification_id=?notification_id, "found notification_id in message attributes");
            notification_id.string_value().unwrap_or_default()
        }).context("notification_id should be a message attribute")?;

        let notification_event_type = attributes.get("notification_event_type").map(|notification_event_type| {
            tracing::trace!(notification_event_type=?notification_event_type, "found notification_event_type in message attributes");
            notification_event_type.string_value().unwrap_or_default()
        }).context("notification_event_type should be a message attribute")?;

        let service_sender = attributes.get("service_sender").map(|service_sender| {
            tracing::trace!(service_sender=?service_sender, "found service_sender in message attributes");
            service_sender.string_value().unwrap_or_default()
        }).context("service_sender should be a message attribute")?;

        (
            macro_uuid::string_to_uuid(notification_id),
            notification_event_type.to_string(),
            service_sender.to_string(),
        )
    } else {
        ctx.worker.cleanup_message(message).await?;
        anyhow::bail!("message attributes not found")
    };

    let notification_id = notification_id?;

    tracing::info!(
        notification_id=?notification_id,
        notification_event_type=?notification_event_type,
        service_sender=?service_sender,
        "message attributes"
    );

    let message_body = if let Some(body) = message.body.as_ref() {
        tracing::trace!(notification_id=%notification_id, notification_event_type=%notification_event_type, service_sender=%service_sender, body=?body, "found body in message");
        serde_json::from_str::<NotificationQueueMessage>(body)?
    } else {
        ctx.worker.cleanup_message(message).await?;
        anyhow::bail!("message body not found")
    };

    tracing::info!(message_body=?message_body, "message body");

    let sender_id = message_body.sender_id.as_ref();
    let recipient_ids = message_body.recipient_ids.as_ref();
    let is_important_v0 = message_body.is_important_v0.unwrap_or(false);

    let notification = Notification {
        id: notification_id,
        notification_entity: message_body.notification_entity,
        service_sender,
        sender_id: sender_id.cloned(),
        temporal: Default::default(), // Created at is set by the database
        notification_event: message_body.notification_event,
    };

    // perform basic rate limiting check
    if rate_limit::rate_limit(&ctx.macro_cache_client, &notification)
        .await
        .context("unable to rate limit notification")?
    {
        tracing::info!(
            notification_id=%notification_id,
            notification_event_type=?notification.notification_event.event_type(),
            sender_id=?sender_id,
            event_item_type=?notification.notification_entity.event_item_type,
            event_item_id=%notification.notification_entity.event_item_id,
            "rate limited notification"
        );
        ctx.worker.cleanup_message(message).await?;
        return Ok(());
    }

    tracing::info!(
        notification_id=%notification_id,
        notification_event_type=%notification.notification_event.event_type(),
        sender_id=?sender_id,
        event_item_type=%notification.notification_entity.event_item_type, event_item_id=%notification.notification_entity.event_item_id,
        "processing message"
    );

    let user_ids =
        filter_sender_id_from_recipient_ids(sender_id, recipient_ids).unwrap_or_default();

    // If there are no users to notify, we can skip the notification
    if user_ids.is_empty() {
        tracing::trace!("no users to notify");
        ctx.worker.cleanup_message(message).await?;
        return Ok(());
    }

    // Filter out all user ids that have this type of notification muted or all notifications muted
    let user_ids = filter_user_ids(
        &ctx.db,
        &notification.notification_entity.event_item_id,
        user_ids,
    )
    .await
    .context("failed to filter user ids")?;

    // Handle cleanup
    if notification.notification_event.event_type() == NotificationEventType::RejectTeamInvite {
        notification_db_client::notification::delete::delete_notification_by_event_item(
            &ctx.db,
            &notification.notification_entity.event_item_id,
            &notification.notification_entity.event_item_type.to_string(),
        )
        .await
        .context("unable to delete notification")?;
    }

    // TODO: [BAC-44] should use connection gateway instead of emit only notifications
    // Handle short circuit for notifications that are not meant to be saved to the database
    // if notification
    //     .notification_event
    //     .event_type()
    //     .is_emit_only_notification()
    // {
    //     tracing::info!(
    //         notification_id=%notification_id,
    //         notification_event_type=%notification.notification_event.event_type(),
    //         sender_id=?sender_id,
    //         event_item_type=%notification.notification_entity.event_item_type, event_item_id=%notification.notification_entity.event_item_id,
    //         user_ids=?user_ids,
    //         "emitting simple notification"
    //     );
    //
    //     let notifications_with_user_data =
    //         populate_user_data(notification, &user_ids, is_important_v0).await;
    //
    //     emit_simple_notification(&ctx, notifications_with_user_data)
    //         .await
    //         .context("unable to emit simple notification")?;
    //     ctx.worker.cleanup_message(message).await?;
    //     return Ok(());
    // }

    // Second check to see if user ids is now empty after filtering
    // If there are no users to notify, we can skip the notification
    if user_ids.is_empty() {
        tracing::trace!("no users to notify");
        ctx.worker.cleanup_message(message).await?;
        return Ok(());
    }

    tracing::trace!(user_ids=?user_ids, "got user ids to notify");

    // Create notification/user_notification(s)
    let notification = create_notification(&ctx.db, notification, &user_ids, is_important_v0)
        .await
        .context("unable to create notification")?;

    // If there is no notification returned, it means the notification already exists
    let notification = match notification {
        Some(notification) => notification,
        None => {
            tracing::trace!("notification already exists, deleting message");
            ctx.worker.cleanup_message(message).await?;
            return Ok(());
        }
    };

    let notification_id = notification.id;

    let mut notifications_with_user_data =
        populate_user_data(notification, &user_ids, is_important_v0).await;

    let users_sent_connection_gateway = send::connection_gateway::send_connection_gateway(
        &ctx.conn_gateway_client,
        &notifications_with_user_data,
    )
    .await
    .context("unable to process connection gateway")?;

    tracing::trace!(users_sent_connection_gateway=?users_sent_connection_gateway, "users sent via connection gateway");

    // transform the message content of the notifications into a human-readable format for push/email notifs
    notifications_with_user_data.iter_mut().for_each(|n| {
        if let Some(message_content) = n.inner.notification_event.get_message_content_mut() {
            *message_content = mention_utils::format_message_mentions(message_content);
        }
    });

    // Get the user ids to attempt sending push notifications to
    let users_to_push = user_ids
        .iter()
        .filter(|user_id| !users_sent_connection_gateway.contains(*user_id))
        .collect::<HashSet<&String>>();

    tracing::trace!(users_to_push=?users_to_push, "users to push");

    // Send push notifications
    let users_sent_push = {
        #[cfg(feature = "push_notification")]
        {
            send::push::process::process_push_notifications(
                &ctx.db,
                &ctx.sns_client,
                &notifications_with_user_data,
                &users_to_push,
            )
            .await
            .context("unable to process push notifications")?
        }
        #[cfg(not(feature = "push_notification"))]
        {
            tracing::info!("bypassing push notifications");
            vec![]
        }
    };

    let users_to_email = users_to_push
        .iter()
        .filter_map(|user_id| {
            if !users_sent_connection_gateway.contains(*user_id) {
                Some(*user_id)
            } else {
                None
            }
        })
        .collect::<HashSet<&String>>();
    tracing::trace!(users_to_email=?users_to_email, "users to email");

    // Transform the Vec into a HashSet
    let users_sent_push = users_sent_push.into_iter().collect::<HashSet<String>>();

    tracing::trace!(users_sent_push=?users_sent_push, "users sent push notification");

    let users_sent_notification = users_sent_connection_gateway
        .union(&users_sent_push)
        .cloned()
        .collect::<Vec<String>>();

    tracing::trace!("updating notifications sent status");
    if let Err(e) = notification_db_client::user_notification::patch::sent::bulk_patch_sent(
        &ctx.db,
        notification_id,
        &users_sent_notification,
    )
    .await
    {
        tracing::error!(error=?e, "failed to update notifications sent status");
    }

    #[cfg(feature = "send_email_notifications")]
    {
        // TODO: update email processing logic to handle NotificationsWithUserData instead of calling concurrently
        // Process email notifications concurrently for each notification
        let email_results: Vec<anyhow::Result<()>> =
            futures::stream::iter(notifications_with_user_data.iter())
                .then(|notification| {
                    let ctx_clone = ctx.clone();
                    async move {
                        send::email::process_email_notifications(
                            &ctx_clone,
                            notification,
                            std::slice::from_ref(&notification.recipient_id),
                        )
                        .await
                        .context("unable to process email notification")
                    }
                })
                .collect()
                .await;

        for (idx, result) in email_results.iter().enumerate() {
            if let Err(e) = result {
                tracing::error!(
                    error=?e,
                    notification_idx=idx,
                    "failed to process email notification"
                );
            }
        }

        if email_results.iter().any(|r| r.is_err()) {
            anyhow::bail!("one or more email notifications failed to process");
        }
    }
    // Remove the message from the queue.
    ctx.worker.cleanup_message(message).await?;

    tracing::trace!(time_elapsed=?original_start_time.elapsed(), "message processed");
    Ok(())
}

/// Filters the user ids to only include users that are not unsubscribed from the given item/event
async fn filter_user_ids(
    db: &sqlx::Pool<sqlx::Postgres>,
    item_id: &str,
    user_ids: Vec<String>,
) -> anyhow::Result<Vec<String>> {
    let mut unsubscribed_users =
        notification_db_client::user_mute_notification::get_user_mute_notification_bulk(
            db,
            user_ids.as_slice(),
        )
        .await
        .context("unable to get user mute notifications")?;

    unsubscribed_users.extend(
        notification_db_client::unsubscribe::item::get_unsubscribed_item_users(db, item_id)
            .await
            .context("unable to get unsubscribed item users")?,
    );

    Ok(user_ids
        .into_iter()
        .filter(|user_id| !unsubscribed_users.contains(user_id))
        .collect())
}
