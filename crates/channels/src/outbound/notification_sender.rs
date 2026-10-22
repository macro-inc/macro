//! Notification adapter for channel notification side effects.

use crate::domain::{
    models::{ChannelMetadata, ChannelType},
    ports::ChannelNotificationSender,
    side_effects::{ChannelMentionNotification, ChannelNotificationEffect},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::{
    ChannelAccessRequestedMetadata, ChannelInviteMetadata, ChannelMentionMetadata,
    ChannelMessageReactionMetadata, ChannelMessageSendMetadata, ChannelReplyMetadata,
    CommonChannelMetadata, DocumentMentionMetadata, NotificationDocumentSubType,
};
use model_owner::Owner;
use notification_hex::domain::{
    models::{
        SendNotificationRequestBuilder,
        request::{NotificationStatus, UpdateNotificationsRequest},
    },
    ports::NotificationWithdrawal,
    service::{NotificationIngress, NotificationReader},
};
use std::{collections::HashSet, sync::Arc};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Notification ingress adapter for channel notification effects.
pub struct NotificationChannelSender<I, C = UnavailableNotificationCompletion> {
    ingress: Arc<I>,
    completion: C,
}

impl<I, C: Clone> Clone for NotificationChannelSender<I, C> {
    fn clone(&self) -> Self {
        Self {
            ingress: self.ingress.clone(),
            completion: self.completion.clone(),
        }
    }
}

impl<I> NotificationChannelSender<I> {
    /// Create a notification sender adapter.
    pub fn new(ingress: Arc<I>) -> Self {
        Self {
            ingress,
            completion: UnavailableNotificationCompletion,
        }
    }
}

impl<I, C> NotificationChannelSender<I, C> {
    /// Complete notifications whose workflow was resolved, such as a request to join.
    pub fn with_completion<C2: CompleteNotifications>(
        self,
        completion: C2,
    ) -> NotificationChannelSender<I, C2> {
        NotificationChannelSender {
            ingress: self.ingress,
            completion,
        }
    }
}

/// Marks a resolved workflow's notification done for everyone who received it.
pub trait CompleteNotifications: Clone + Send + Sync + 'static {
    /// Complete one notification for each recipient, including delayed deliveries.
    fn complete(
        &self,
        notification_id: Uuid,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

/// Fail-closed completion for contexts that never resolve channel workflows.
#[derive(Debug, Clone, Copy, Default)]
pub struct UnavailableNotificationCompletion;

impl CompleteNotifications for UnavailableNotificationCompletion {
    async fn complete(
        &self,
        _notification_id: Uuid,
        _recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> anyhow::Result<()> {
        anyhow::bail!("notification completion is not configured")
    }
}

/// Withdraws a notification so delayed deliveries are dropped, then marks it
/// done for each recipient.
pub struct NotificationReaderCompletion<N, W> {
    reader: Arc<N>,
    withdrawal: Arc<W>,
}

impl<N, W> NotificationReaderCompletion<N, W> {
    /// Complete through the notification reader and withdrawal adapters.
    pub fn new(reader: Arc<N>, withdrawal: Arc<W>) -> Self {
        Self { reader, withdrawal }
    }
}

impl<N, W> Clone for NotificationReaderCompletion<N, W> {
    fn clone(&self) -> Self {
        Self {
            reader: self.reader.clone(),
            withdrawal: self.withdrawal.clone(),
        }
    }
}

impl<N: NotificationReader, W: NotificationWithdrawal> CompleteNotifications
    for NotificationReaderCompletion<N, W>
{
    async fn complete(
        &self,
        notification_id: Uuid,
        recipients: HashSet<MacroUserIdStr<'static>>,
    ) -> anyhow::Result<()> {
        self.withdrawal
            .withdraw(notification_id)
            .await
            .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        for user_id in recipients {
            self.reader
                .update_notifications(UpdateNotificationsRequest {
                    user_id,
                    notification_ids: &[notification_id],
                    status: NotificationStatus::Done(true),
                })
                .await
                .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        }
        Ok(())
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
    let notification = ChannelInviteMetadata {
        invited_by: invited_by_user_id.clone(),
        channel_name: common.channel_name,
        is_direct_message: matches!(
            common.channel_type,
            model_notifications::ChannelType::DirectMessage
        ),
        sender_profile_picture_url,
        message_content,
    };
    let _ = tokio::try_join!(
        ingress.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: model_entity::EntityType::Channel
                    .with_entity_string(channel_id.to_string()),
                secondary_notification_entity: None,
                notification: notification.clone(),
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
                secondary_notification_entity: None,
                notification,
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

fn secondary_channel_thread_entity(
    thread_id: Option<Uuid>,
) -> Option<model_entity::Entity<'static>> {
    thread_id.map(|thread_id| {
        model_entity::EntityType::ChannelMessage.with_entity_string(thread_id.to_string())
    })
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

impl<I, C> ChannelNotificationSender for NotificationChannelSender<I, C>
where
    I: NotificationIngress + 'static,
    C: CompleteNotifications,
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
                // A mention's thread row is keyed by its thread root: the
                // containing thread for a reply, the message itself for a
                // top-level mention. Without the fallback a top-level mention
                // carries no secondary entity, and the inbox's channel-thread
                // query (which matches notifications by secondary entity)
                // can never surface it — the channel row deliberately leaves
                // mentions to thread rows, so the mention would show nowhere.
                let secondary_notification_entity = secondary_channel_thread_entity(Some(
                    mention.thread_id.unwrap_or(mention.message_id),
                ));
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            secondary_notification_entity,
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
                // Same thread-root fallback as UserMention above: a top-level
                // mention's thread row is keyed by the message itself, so
                // without it the inbox's channel-thread query could never
                // surface the mention.
                let secondary_notification_entity = secondary_channel_thread_entity(Some(
                    mention.thread_id.unwrap_or(mention.message_id),
                ));
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            secondary_notification_entity,
                            notification: DocumentMentionMetadata {
                                document_name: document.document_name,
                                owner: Owner::User(document.owner),
                                file_type: document.file_type,
                                sub_type: match document.sub_type.as_deref() {
                                    Some("task") => Some(NotificationDocumentSubType::Task),
                                    Some("snippet") => Some(NotificationDocumentSubType::Snippet),
                                    Some("skill") => Some(NotificationDocumentSubType::Skill),
                                    Some("initiative_description") => {
                                        Some(NotificationDocumentSubType::InitiativeDescription)
                                    }
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
                            secondary_notification_entity: Some(
                                model_entity::EntityType::ChannelMessage
                                    .with_entity_string(thread_id.to_string()),
                            ),
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
                            secondary_notification_entity: None,
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
            ChannelNotificationEffect::Reaction {
                channel_id,
                message_id,
                thread_id,
                message_content,
                emoji,
                sender_id,
                metadata,
                sender_profile_picture_url,
                recipient_id,
            } => {
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(channel_id.to_string()),
                            secondary_notification_entity: secondary_channel_thread_entity(Some(
                                thread_id.unwrap_or(message_id),
                            )),
                            notification: ChannelMessageReactionMetadata {
                                message_id: message_id.to_string(),
                                thread_id: thread_id.map(|id| id.to_string()),
                                message_content,
                                emoji,
                                common: to_common_metadata(metadata),
                                sender_profile_picture_url,
                            },
                            sender_id: Some(sender_id),
                            recipient_ids: HashSet::from([recipient_id]),
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
            ChannelNotificationEffect::AccessRequested {
                request,
                sender_profile_picture_url,
                metadata,
                recipient_ids,
            } => {
                // The attempt id is the notification id, so resolving the
                // attempt can complete it for every participant.
                self.ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: model_entity::EntityType::Channel
                                .with_entity_string(request.channel_id.to_string()),
                            secondary_notification_entity: None,
                            notification: ChannelAccessRequestedMetadata {
                                request_id: request.id,
                                common: to_common_metadata(metadata),
                                sender_profile_picture_url,
                            },
                            sender_id: Some(request.requester_id),
                            recipient_ids,
                        }
                        .into_request_with_id(request.id)
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            ChannelNotificationEffect::AccessRequestResolved {
                request_id,
                recipient_ids,
            } => {
                self.completion.complete(request_id, recipient_ids).await?;
            }
        }

        Ok(())
    }
}
