//! Notification adapter for channel notification side effects.

use crate::domain::{
    models::{ChannelMetadata, ChannelType},
    ports::ChannelNotificationSender,
    side_effects::{ChannelMentionNotification, ChannelNotificationEffect},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DocumentMentionMetadata,
    NotificationDocumentSubType,
};
use notification_hex::domain::{
    models::SendNotificationRequestBuilder, service::NotificationIngress,
};
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

/// Notification ingress adapter for channel notification effects.
#[derive(Clone)]
pub struct NotificationChannelSender<I> {
    ingress: Arc<I>,
}

impl<I> NotificationChannelSender<I> {
    /// Create a notification sender adapter.
    pub fn new(ingress: Arc<I>) -> Self {
        Self { ingress }
    }
}

fn to_notification_channel_type(channel_type: ChannelType) -> model_notifications::ChannelType {
    match channel_type {
        ChannelType::Public => model_notifications::ChannelType::Public,
        ChannelType::Private => model_notifications::ChannelType::Private,
        ChannelType::DirectMessage => model_notifications::ChannelType::DirectMessage,
        ChannelType::Team => model_notifications::ChannelType::Team,
    }
}

fn to_common_metadata(metadata: ChannelMetadata) -> CommonChannelMetadata {
    CommonChannelMetadata {
        channel_type: to_notification_channel_type(metadata.channel_type),
        channel_name: metadata.channel_name,
    }
}

struct InviteNotificationDelivery {
    channel_id: Uuid,
    invited_by_user_id: MacroUserIdStr<'static>,
    registered_recipient_ids: HashSet<MacroUserIdStr<'static>>,
    unregistered_recipient_ids: HashSet<MacroUserIdStr<'static>>,
    sender_profile_picture_url: Option<String>,
    message_content: Option<String>,
    common: CommonChannelMetadata,
}

async fn send_invite_notifications(
    ingress: &impl NotificationIngress,
    delivery: InviteNotificationDelivery,
) -> anyhow::Result<()> {
    let InviteNotificationDelivery {
        channel_id,
        invited_by_user_id,
        registered_recipient_ids,
        unregistered_recipient_ids,
        sender_profile_picture_url,
        message_content,
        common,
    } = delivery;
    let _ = tokio::try_join!(
        ingress.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: model_entity::EntityType::Channel
                    .with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                    message_content: message_content.clone(),
                },
                sender_id: Some(invited_by_user_id.clone()),
                recipient_ids: registered_recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway(),
        ),
        ingress.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: model_entity::EntityType::Channel
                    .with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url,
                    message_content,
                },
                sender_id: Some(invited_by_user_id.clone()),
                recipient_ids: unregistered_recipient_ids,
            }
            .into_request()
            .with_email(),
        )
    )
    .map_err(|e| anyhow::anyhow!("{e:?}"))?;

    Ok(())
}

fn to_channel_mention_metadata(mention: ChannelMentionNotification) -> ChannelMentionMetadata {
    ChannelMentionMetadata {
        message_content: mention.message_content,
        message_id: mention.message_id.to_string(),
        has_attachments: mention.has_attachments,
        thread_id: mention.thread_id.map(|thread_id| thread_id.to_string()),
        sender_display_name: mention.sender.display_name().map(ToOwned::to_owned),
        common: to_common_metadata(mention.metadata),
        sender_profile_picture_url: mention.sender_profile_picture_url,
    }
}

impl<I> ChannelNotificationSender for NotificationChannelSender<I>
where
    I: NotificationIngress + 'static,
{
    type Err = anyhow::Error;

    async fn send(&self, notification: ChannelNotificationEffect) -> Result<(), Self::Err> {
        match notification {
            ChannelNotificationEffect::UserMention {
                mention,
                recipient_ids,
            } => {
                let channel_id = mention.channel_id;
                let sender_id = mention.sender.as_user().cloned();
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            notification: to_channel_mention_metadata(mention),
                            sender_id,
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            ChannelNotificationEffect::DocumentMention {
                mention,
                document,
                recipient_ids,
            } => {
                let channel_id = mention.channel_id;
                let sender_id = mention.sender.as_user().cloned();
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            notification: DocumentMentionMetadata {
                                document_name: document.document_name,
                                owner: document.owner,
                                file_type: document.file_type,
                                sub_type: match document.sub_type.as_deref() {
                                    Some("task") => Some(NotificationDocumentSubType::Task),
                                    Some("snippet") => Some(NotificationDocumentSubType::Snippet),
                                    _ => None,
                                },
                                channel: to_channel_mention_metadata(mention),
                            },
                            sender_id,
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            ChannelNotificationEffect::Reply {
                channel_id,
                thread_id,
                message_id,
                sender,
                message_content,
                has_attachments,
                thread_parent_sender_id,
                metadata,
                sender_profile_picture_url,
                recipient_ids,
            } => {
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            notification: ChannelReplyMetadata {
                                thread_id: thread_id.to_string(),
                                message_id: message_id.to_string(),
                                user_id: sender.as_user().cloned(),
                                sender_display_name: sender.display_name().map(ToOwned::to_owned),
                                message_content,
                                has_attachments,
                                thread_parent_sender_id,
                                common: to_common_metadata(metadata),
                                sender_profile_picture_url,
                            },
                            sender_id: sender.as_user().cloned(),
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            ChannelNotificationEffect::ChannelMessage {
                channel_id,
                message_id,
                sender,
                message_content,
                has_attachments,
                metadata,
                sender_profile_picture_url,
                recipient_ids,
            } => {
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            notification: ChannelMessageSendMetadata {
                                message_id: message_id.to_string(),
                                sender: sender.as_user().cloned(),
                                sender_display_name: sender.display_name().map(ToOwned::to_owned),
                                message_content,
                                has_attachments,
                                common: to_common_metadata(metadata),
                                sender_profile_picture_url,
                            },
                            sender_id: sender.as_user().cloned(),
                            recipient_ids,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            ChannelNotificationEffect::Invite {
                channel_id,
                invited_by_user_id,
                registered_recipient_ids,
                unregistered_recipient_ids,
                sender_profile_picture_url,
                message_content,
                metadata,
            } => {
                send_invite_notifications(
                    &*self.ingress,
                    InviteNotificationDelivery {
                        channel_id,
                        invited_by_user_id,
                        registered_recipient_ids,
                        unregistered_recipient_ids,
                        sender_profile_picture_url,
                        message_content,
                        common: to_common_metadata(metadata),
                    },
                )
                .await?;
            }
        }

        Ok(())
    }
}
