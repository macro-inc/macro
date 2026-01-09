use crate::{api::context::ApiContext, config::APPLE_BUNDLE_ID};
use anyhow::Context;
use futures::StreamExt;
use notification_db_client::notification::get::DbBasicNotification;
use serde::Serialize;
use sns_client::{APNSPushNotification, MessageAttributes, PushType, SnsTarget};
use std::borrow::Cow;

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
                    let device_endpoints = device_endpoints.clone();
                    async move {
                        let notif =
                            notification_db_client::notification::get::get_basic_notification(
                                &db,
                                notification_id,
                            )
                            .await?
                            .transpose()
                            .context("Cannot clear a notification without an apns collapse key")?;

                        clear_push_notification(&sns_client, &device_endpoints, notif).await
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
#[tracing::instrument(err, skip(sns_client))]
pub async fn clear_push_notification(
    sns_client: &sns_client::SNS,
    device_endpoints: &[String],
    basic_notification: DbBasicNotification<String>,
) -> anyhow::Result<()> {
    // As of right now, we can only do this for APNS notifications since android requires a
    // custom push notification handler in order to clear the notification on the mobile application side
    let collapse_key = basic_notification.apns_collapse_key;

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
        collapse_key,
    };

    futures::stream::iter(device_endpoints.iter())
        .then(|endpoint| async {
            if !endpoint.contains("APNS") {
                tracing::trace!("skipping non-apns endpoint");
                return;
            }
            let _ = sns_client
                .push_notification(endpoint, &apns, attributes.clone())
                .await;
        })
        .collect::<Vec<_>>()
        .await;

    Ok(())
}

/// Clears out push notifications for a user by notification event
#[tracing::instrument(err, skip(ctx))]
pub async fn clear_push_notifications_basic(
    ctx: ApiContext,
    user_id: Cow<'_, str>,
    notification: DbBasicNotification<Option<String>>,
) -> anyhow::Result<()> {
    tracing::trace!("clearing potential push notifications");
    let db = ctx.db.clone();
    let sns_client = ctx.sns_client.clone();
    let user_id = user_id.to_string();
    tracing::trace!("removing push notifications");

    let device_endpoints = notification_db_client::device::get_user_device_endpoints(&db, &user_id)
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "failed to get device endpoints");
        })
        .unwrap_or(Vec::new());

    if device_endpoints.is_empty() {
        tracing::trace!("user has no device endpoints, skipping push notification clearing");
        return Ok(());
    }

    let Some(basic_notification) = notification.transpose() else {
        tracing::trace!("cannot clear a notification that is missing a collapse key");
        return Ok(());
    };

    let _ = clear_push_notification(&sns_client, &device_endpoints, basic_notification).await;

    Ok(())
}
