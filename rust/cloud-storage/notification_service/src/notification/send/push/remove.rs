use crate::{api::context::ApiContext, config::APPLE_BUNDLE_ID};
use anyhow::Context;
use futures::StreamExt;
use notification_db_client::notification::get::BasicNotification;
use serde::Serialize;
use sns_client::{APNSPushNotification, MessageAttributes, NotifCollapseKey, PushType, SnsTarget};
use std::hash::{DefaultHasher, Hash, Hasher};

/// Clears out push notifications for a user in bulk
#[tracing::instrument(skip(ctx))]
pub fn clear_push_notifications(
    ctx: ApiContext,
    notification_ids: &[uuid::Uuid],
    user_id: &str,
) -> anyhow::Result<()> {
    tracing::trace!("clearing potential push notifications");
    tokio::spawn({
        let notification_ids = notification_ids.to_vec();
        let user_id = user_id.to_string();
        async move {
            let db = ctx.db;
            let sns_client = ctx.sns_client;
            tracing::trace!(notification_ids=?notification_ids, user_id=user_id, "removing push notifications");

            let device_endpoints = notification_db_client::device::get_user_device_endpoints(
                &db, &user_id,
            )
            .await
            .inspect_err(|e| {
                tracing::error!(error=?e, user_id=user_id, "failed to get device endpoints");
            })
            .unwrap_or(Vec::new());

            if device_endpoints.is_empty() {
                tracing::trace!(
                    "user has no device endpoints, skipping push notification clearing"
                );
                return;
            }

            let _ = futures::stream::iter(notification_ids.iter())
                .then(|notification_id| {
                    let sns_client = sns_client.clone();
                    let db = db.clone();
                    let user_id = user_id.clone();
                    let device_endpoints = device_endpoints.clone();
                    async move {
                        if let Err(e) =
                            clear_push_notification(
                                &db,
                                &sns_client,
                                &device_endpoints,
                                Some(&notification_id.to_string()),
                                None,
                            )
                            .await
                        {
                            tracing::error!(error=?e, notification_id=notification_id.to_string(), user_id=user_id, "failed to remove push notification");
                        }

                        Ok(())
                    }
                })
                .collect::<Vec<anyhow::Result<()>>>()
                .await;

            tracing::trace!(notification_ids=?notification_ids, user_id=user_id, "removing push notifications complete");
        }
    });

    Ok(())
}

/// When a notification is marked as "done" or "seen" for a user, we need to potentially send a
/// remove notification sns notification to the user to clear it from their device.
#[tracing::instrument(skip(db, sns_client))]
pub async fn clear_push_notification(
    db: &sqlx::Pool<sqlx::Postgres>,
    sns_client: &sns_client::SNS,
    device_endpoints: &[String],
    notification_id: Option<&str>,
    basic_notification: Option<&BasicNotification>,
) -> anyhow::Result<()> {
    // As of right now, we can only do this for APNS notifications since android requires a
    // custom push notification handler in order to clear the notification on the mobile application side
    let BasicNotification {
        event_item_id,
        event_item_type: _,
        notification_event_type,
    } = if let Some(basic_notification) = basic_notification {
        basic_notification
    } else {
        &notification_db_client::notification::get::get_basic_notification(
            db,
            notification_id.context("expected notification_id")?,
        )
        .await
        .context("failed to get notification")?
    };

    let collapse_key = format!("{}{}", event_item_id, notification_event_type);

    // hash the collapse key to shorten it
    let mut hasher = DefaultHasher::new();
    collapse_key.hash(&mut hasher);
    let hash = hasher.finish();
    let collapse_key = format!("{:x}", hash);

    #[derive(Debug, Serialize, Clone)]
    struct CustomData {
        identifier: String,
    }

    let apns = SnsTarget::Ios(Box::new(APNSPushNotification {
        aps: sns_client::Aps {
            content_available: Some(1),
            ..Default::default()
        },
        push_notification_data: CustomData {
            identifier: collapse_key.clone(),
        },
    }));
    let attributes = MessageAttributes {
        push_type: PushType::Background,
        apns_bundle_id: &APPLE_BUNDLE_ID,
        collapse_key: NotifCollapseKey::new_str(&collapse_key),
    };

    futures::stream::iter(device_endpoints.iter())
        .then(|endpoint| async {
            if !endpoint.contains("APNS") {
                tracing::trace!("skipping non-apns endpoint");
                return;
            }
            if let Err(e) = sns_client
                .push_notification(endpoint, &apns, attributes.clone())
                .await
            {
                tracing::warn!(error=?e, "unable to send push notification");
            }
        })
        .collect::<Vec<_>>()
        .await;

    Ok(())
}

/// Clears out push notifications for a user by notification event
#[tracing::instrument(skip(ctx))]
pub async fn clear_push_notifications_basic(
    ctx: ApiContext,
    user_id: &str,
    notification: &BasicNotification,
) -> anyhow::Result<()> {
    tracing::trace!("clearing potential push notifications");
    tokio::spawn({
        let db = ctx.db.clone();
        let sns_client = ctx.sns_client.clone();
        let user_id = user_id.to_string();
        let basic_notification = notification.clone();
        async move {
            tracing::trace!("removing push notifications");

            let device_endpoints =
                notification_db_client::device::get_user_device_endpoints(&db, &user_id)
                    .await
                    .inspect_err(|e| {
                        tracing::error!(error=?e, "failed to get device endpoints");
                    })
                    .unwrap_or(Vec::new());

            if device_endpoints.is_empty() {
                tracing::trace!(
                    "user has no device endpoints, skipping push notification clearing"
                );
                return;
            }
            if let Err(e) = clear_push_notification(
                &db,
                &sns_client,
                &device_endpoints,
                None,
                Some(&basic_notification),
            )
            .await
            {
                tracing::error!(error=?e, basic_notification=?basic_notification, user_id=user_id, "failed to remove push notification");
            }

            tracing::trace!(basic_notification=?basic_notification, user_id=user_id, "removing push notifications complete");
        }
    });

    Ok(())
}
