use crate::config::APPLE_BUNDLE_ID;
use anyhow::Context;
use aws_sdk_sns::types::MessageAttributeValue;
use model::document::{FileType, FileTypeExt};
use model_notifications::NotificationWithRecipient;
use model_notifications::{
    APNSPushNotification, ChannelInviteMetadata, ChannelMentionMetadata,
    ChannelMessageSendMetadata, ChannelReplyMetadata, DocumentMentionMetadata,
    NotificationEventType, PushNotificationData,
};
use models_comms::ChannelType;
use std::str::FromStr;
use std::{
    collections::HashMap,
    hash::{DefaultHasher, Hash, Hasher},
};

/// Builds the message attributes for the push notification
pub fn build_message_attributes(
    collapse_key: &str,
) -> Option<HashMap<String, MessageAttributeValue>> {
    Some(HashMap::from([
        (
            "AWS.SNS.MOBILE.APNS.TOPIC".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(&*APPLE_BUNDLE_ID)
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PUSH_TYPE".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("alert")
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.PRIORITY".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value("5") // 5 is normal, 10 is high
                .build()
                .unwrap(),
        ),
        (
            "AWS.SNS.MOBILE.APNS.COLLAPSE_ID".to_string(),
            MessageAttributeValue::builder()
                .data_type("String")
                .string_value(collapse_key)
                .build()
                .unwrap(),
        ),
    ]))
}

type PushNotificationResult = Option<(
    serde_json::Value,
    Option<HashMap<String, MessageAttributeValue>>,
)>;

/// Given a notification, this generates a push notification object
/// Returns (message_json, message_attributes) if the notification is valid
/// Returns Err if the notification is invalid
/// NOTE: @synoet - I think push notifications should be generated using the new
/// [NotificationEvnet] type instead of the [NotificationWithRecipient] type
/// Simmilarly, each of these should implement some sort of PushDisplay trait
pub fn generate_push_notification(
    notification: &NotificationWithRecipient,
) -> anyhow::Result<PushNotificationResult> {
    let (title, message, open_route): (String, String, String) =
        match notification.inner.notification_event.event_type() {
            NotificationEventType::ChannelInvite => {
                let metadata = if let Some(metadata) = notification
                    .inner
                    .notification_event
                    .metadata_json()
                    .as_ref()
                {
                    metadata.clone()
                } else {
                    return Err(anyhow::anyhow!("notification does not have metadata"));
                };
                let metadata: ChannelInviteMetadata = serde_json::from_value(metadata.clone())?;

                let title = format!(
                    "{} invited you to join {}",
                    metadata.invited_by, metadata.common.channel_name
                );

                let open_route = format!(
                    "/channel/{}",
                    notification.inner.notification_entity.event_item_id
                );

                (title, "".to_string(), open_route)
            }
            NotificationEventType::ChannelMessageSend => {
                let metadata = if let Some(metadata) = notification
                    .inner
                    .notification_event
                    .metadata_json()
                    .as_ref()
                {
                    metadata.clone()
                } else {
                    return Err(anyhow::anyhow!("notification does not have metadata"));
                };
                let metadata: ChannelMessageSendMetadata =
                    serde_json::from_value(metadata.clone())?;
                let message: String = metadata.message_content;
                let email = notification
                    .inner
                    .sender_id
                    .clone()
                    .context("expected sender id")?
                    .replace("macro|", "");

                let message_item = if message.is_empty() {
                    "an attachment"
                } else {
                    "a message"
                };

                let channel_name = metadata.common.channel_name;

                let title = match metadata.common.channel_type {
                    ChannelType::DirectMessage => {
                        format!("{} sent you {}", email, message_item)
                    }
                    _ => {
                        format!("{} sent {} to #{}", email, message_item, channel_name)
                    }
                };

                let message_id = format!("?message_id={}", metadata.message_id);

                let open_route = format!(
                    "/channel/{}{}",
                    notification.inner.notification_entity.event_item_id, message_id
                );

                (title, message, open_route)
            }
            NotificationEventType::ChannelMessageReply => {
                let metadata = if let Some(metadata) = notification
                    .inner
                    .notification_event
                    .metadata_json()
                    .as_ref()
                {
                    metadata.clone()
                } else {
                    return Err(anyhow::anyhow!("notification does not have metadata"));
                };
                let metadata: ChannelReplyMetadata = serde_json::from_value(metadata.clone())?;
                let message = metadata.message_content;

                let email = notification
                    .inner
                    .sender_id
                    .clone()
                    .context("expected sender id")?
                    .replace("macro|", "");

                let title = format!("{} replied to thread", email);
                let open_route = format!(
                    "/channel/{}?message_id={}&thread_id={}",
                    notification.inner.notification_entity.event_item_id,
                    metadata.message_id,
                    metadata.thread_id
                );

                (title, message, open_route)
            }
            NotificationEventType::ChannelMention => {
                let channel_metadata = if let Some(channel_metadata) =
                    &notification.inner.notification_event.metadata_json()
                {
                    channel_metadata.clone()
                } else {
                    return Err(anyhow::anyhow!("no channel metadata was provided"));
                };

                let metadata: ChannelMentionMetadata = serde_json::from_value(channel_metadata)?;

                let email = notification
                    .inner
                    .sender_id
                    .clone()
                    .context("expected sender id")?
                    .replace("macro|", "");

                let message = metadata.message_content;

                let title = format!(
                    "{} mentioned you in #{}",
                    email, metadata.common.channel_name
                );

                let thread_id = if let Some(thread_id) = metadata.thread_id {
                    format!("&thread_id={}", thread_id)
                } else {
                    "".to_string()
                };

                let open_route = format!(
                    "/channel/{}?message_id={}{}",
                    notification.inner.notification_entity.event_item_id,
                    metadata.message_id,
                    thread_id
                );

                (title, message, open_route)
            }
            NotificationEventType::DocumentMention => {
                let document_metadata = if let Some(document_metadata) =
                    &notification.inner.notification_event.metadata_json()
                {
                    document_metadata.clone()
                } else {
                    return Err(anyhow::anyhow!("no document metadata was provided"));
                };

                let metadata: DocumentMentionMetadata = serde_json::from_value(document_metadata)?;

                let sender_id = notification
                    .inner
                    .sender_id
                    .as_ref()
                    .context("expected sender id")?;

                if let Some(file_type) = metadata.file_type {
                    let email = sender_id.replace("macro|", "");
                    let message = format!(
                        "{} mentioned you in {}.{}",
                        email, metadata.document_name, file_type
                    );
                    let file_type = FileType::from_str(file_type.as_str())?;

                    let block_route = if file_type.is_image() {
                        "image"
                    } else {
                        match file_type {
                            FileType::Pdf => "pdf",
                            FileType::Docx => "write",
                            FileType::Md => "md",
                            _ => "code", // Default to code block
                        }
                    };

                    let open_route = format!(
                        "/{}/{}",
                        block_route, notification.inner.notification_entity.event_item_id
                    );

                    ("New Mention".to_string(), message, open_route)
                } else {
                    return Err(anyhow::anyhow!("no file type was provided"));
                }
            }
            // no push notifs for email yet

            // NotificationEventType::NewEmail => {
            //     let metadata = if let Some(metadata) = notification.inner.notification_event.metadata_as_json().as_ref() {
            //         metadata.clone()
            //     } else {
            //         return Err(anyhow::anyhow!("notification does not have metadata"));
            //     };
            //     let metadata: NewEmailMetadata = serde_json::from_value(metadata)?;
            //
            //     let title = if let Some(from_email) = metadata.sender {
            //         format!("New email from {}", from_email)
            //     } else {
            //         "New email".to_string()
            //     };
            //     let message = metadata.subject;
            //     let open_route = format!(
            //         "/email/{}?message_id={}",
            //         metadata.thread_id, notification.inner.notification_entity.event_item_id
            //     );
            //
            //     (title, message, open_route)
            // }
            _ => return Ok(None), // unsupported push notification
        };

    tracing::trace!(message=?message, "created message");

    let collapse_key = format!(
        "{}{}",
        notification.inner.notification_entity.event_item_id,
        notification.inner.notification_event.event_type()
    );

    // hash the collapse key to shorten it
    let mut hasher = DefaultHasher::new();
    collapse_key.hash(&mut hasher);
    let hash = hasher.finish();
    let collapse_key = format!("{:x}", hash);

    let push_notification_data = PushNotificationData {
        notification_entity: notification.inner.notification_entity.clone(),
        sender_id: notification.inner.sender_id.clone(),
        open_route: open_route.clone(),
    };

    let notification_body = serde_json::json!({
        "title": title,
        "body": message,
    });

    let apns = APNSPushNotification {
        aps: serde_json::json!({
            "alert": notification_body
        }),
        push_notification_data: push_notification_data.clone(),
    };

    let message_json = serde_json::json!({
        "default": serde_json::json!({
            "notification": notification_body
        }).to_string(),
        "APNS": serde_json::to_string(&apns).unwrap_or_else(|_| serde_json::json!({
            "aps": apns.aps
        }).to_string()),
        "GCM": serde_json::json!({
            "fcmV1Message": {
                "message": {
                    "android": {
                        "notification": notification_body,
                        "priority": "normal", // options are normal and high
                        "collapse_key": collapse_key.clone()
                    },
                    "data": push_notification_data,
                },
            }
        }).to_string()
    });

    Ok(Some((
        message_json,
        build_message_attributes(&collapse_key),
    )))
}
