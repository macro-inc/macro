use std::collections::{HashMap, HashSet};

use anyhow::Context;
use futures::StreamExt;
use model_notifications::NotificationWithRecipient;

use super::generate::generate_push_notification;

/// Attempts to send push notifications to provided users
/// Returns a list of users who were sent push notifications.
#[tracing::instrument(skip(db, sns_client, user_ids))]
pub async fn process_push_notifications(
    db: &sqlx::Pool<sqlx::Postgres>,
    sns_client: &sns_client::SNS,
    notifications: &[NotificationWithRecipient],
    user_ids: &HashSet<&String>,
) -> anyhow::Result<Vec<String>> {
    let user_ids = user_ids
        .iter()
        .map(|user_id| user_id.to_string())
        .collect::<Vec<String>>();

    let user_device_endpoints: HashMap<String, Vec<String>> =
        notification_db_client::device::get_users_device_endpoints(db, &user_ids).await?;
    tracing::trace!(device_endpoints=?user_device_endpoints, "got device endpoints to send push notifications to");

    // create a map where key is recipient_id and value is the push notif to send
    let notification_map = notifications
        .iter()
        .filter_map(|n| {
            let push_notification = generate_push_notification(n)
                .context("unable to generate push notification for user")
                .ok()?; // Return None if error

            push_notification.map(|pn| (n.recipient_id.clone(), pn))
        })
        .collect::<HashMap<String, _>>();

    if notification_map.is_empty() {
        // There are no push notifications to send
        return Ok(user_ids.to_vec());
    }

    // Goes through each user attempting to send a push notification, returning the user id and
    // PushNotificationStatus
    let result: Vec<(String, PushNotificationStatus)> = futures::stream::iter(
        // Only include items where the user ID exists in notification_map
        user_device_endpoints
            .iter()
            .filter(|(user_id, _)| notification_map.contains_key(*user_id)),
    )
    .then(|(user_id, endpoints)| {
        // safe to unwrap because we filter above
        let push_notification = notification_map.get(user_id).unwrap();
        let message_json = push_notification.0.clone();
        let message_attributes = push_notification.1.clone();
        async move {
            tracing::trace!(user_id=%user_id, "sending push notification");
            if endpoints.is_empty() {
                return (user_id.clone(), PushNotificationStatus::Empty);
            }
            let mut success = false;

            // while most users will have 1 endpoint, we need to handle the case where a user
            // has multiple endpoints
            for item in endpoints {
                if let Err(e) = sns_client
                    .push_notification(item, &message_json.to_string(), message_attributes.clone())
                    .await
                {
                    tracing::warn!(error=?e, "unable to send push notification");
                    continue;
                }
                // we successfully sent at least one push notification to a user's device
                success = true;
            }
            let status = if success {
                PushNotificationStatus::Success
            } else {
                PushNotificationStatus::Fail
            };
            (user_id.clone(), status)
        }
    })
    .collect::<Vec<_>>()
    .await;

    let users_notified = result
        .iter()
        .filter_map(|r| {
            let (user_id, status) = r;
            match status {
                PushNotificationStatus::Success => Some(user_id.clone()),
                PushNotificationStatus::Empty | PushNotificationStatus::Fail => None,
            }
        })
        .collect::<Vec<String>>();

    Ok(users_notified)
}

pub enum PushNotificationStatus {
    /// No push notifications were sent
    Empty,
    /// Successfully sent a push notification for the user
    Success,
    /// Failed to send push notifications for the user
    Fail,
}
