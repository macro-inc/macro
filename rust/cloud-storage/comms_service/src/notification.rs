use crate::api::context::AppState;
use comms_db_client::{
    messages::get_count::check_if_channel_has_messages,
    messages::get_message_owner::get_message_owner,
    model::{Message, SimpleMention},
    participants::get_participants::get_channel_participants_for_thread_id,
};
use macro_db_client::notification::BasicCloudStorageItemMetadata;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::comms::ChannelParticipant;
use model_entity::EntityType;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DocumentMentionMetadata,
};
use notification_hex::domain::models::SendNotificationRequestBuilder;
use notification_hex::domain::service::NotificationIngress;
use std::{collections::HashSet, iter::once};
use uuid::Uuid;

#[cfg(test)]
mod test;

struct ChannelMessageEvent<'a> {
    channel_id: &'a Uuid,
    message: &'a Message,
    channel_metadata: &'a CommonChannelMetadata,
    channel_message_count: usize,
    user_mentions: &'a [String],
    document_mentions: &'a [BasicCloudStorageItemMetadata],
    participants: &'a [ChannelParticipant],
    thread_participants: &'a [MacroUserIdStr<'static>],
    thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
    sender_profile_picture_url: Option<String>,
}

fn recipients_excluding<'a>(
    recipients: impl IntoIterator<Item = &'a str>,
    exclude: impl IntoIterator<Item = &'a str>,
) -> impl Iterator<Item = MacroUserIdStr<'static>> {
    let exclude_set: HashSet<&str> = exclude.into_iter().collect();
    recipients
        .into_iter()
        .filter(move |id| !exclude_set.contains(id))
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .map(|u| u.into_owned())
}

impl ChannelMessageEvent<'_> {
    async fn send(&self, ingress: &impl NotificationIngress) -> anyhow::Result<()> {
        let entity = || EntityType::Channel.with_entity_string(self.channel_id.to_string());
        let sender = || Some(self.message.sender_id.clone());

        // Send mention notifications for @mentioned users
        if !self.user_mentions.is_empty() {
            ingress
                .send_notification(
                    SendNotificationRequestBuilder {
                        notification_entity: entity(),
                        notification: ChannelMentionMetadata {
                            message_content: self.message.content.clone(),
                            message_id: self.message.id.to_string(),
                            thread_id: self.message.thread_id.map(|t| t.to_string()),
                            common: self.channel_metadata.clone(),
                            sender_profile_picture_url: self.sender_profile_picture_url.clone(),
                        },
                        sender_id: sender(),
                        recipient_ids: recipients_excluding(
                            self.user_mentions.iter().map(|m| m.as_str()),
                            once(self.message.sender_id.0.as_ref()),
                        )
                        .collect(),
                    }
                    .into_request()
                    .with_apns()
                    .with_conn_gateway(),
                )
                .await
                .map_err(|e| anyhow::anyhow!("{e:?}"))?;
        }

        // Send document mention notifications
        if !self.document_mentions.is_empty() {
            let doc_recipients: HashSet<_> = recipients_excluding(
                self.participants.iter().map(|p| p.user_id.as_ref()),
                once(self.message.sender_id.0.as_ref()),
            )
            .collect();

            for mention in self.document_mentions {
                ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: entity(),
                            notification: DocumentMentionMetadata {
                                document_name: mention.item_name.clone(),
                                owner: mention.item_owner.clone(),
                                file_type: mention.file_type.clone(),
                                sender_profile_picture_url: self.sender_profile_picture_url.clone(),
                            },
                            sender_id: sender(),
                            recipient_ids: doc_recipients.clone(),
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
        }

        let sender_and_mentions = once(self.message.sender_id.0.as_ref())
            .chain(self.user_mentions.iter().map(String::as_str))
            .collect::<Vec<&str>>();

        // MessageSend and Invite notifications are sent to all participants except the sender and
        // mentioned users. Mentioned users receive a separate ChannelMention notification.
        let recipients_without_sender_and_mentions: HashSet<_> = recipients_excluding(
            self.participants.iter().map(|p| p.user_id.as_ref()),
            sender_and_mentions.clone(),
        )
        .collect();

        match (self.channel_message_count, self.message.thread_id) {
            // Thread Message Reply
            (_, Some(thread_id)) => {
                if !self.thread_participants.is_empty() {
                    ingress
                        .send_notification(
                            SendNotificationRequestBuilder {
                                notification_entity: entity(),
                                notification: ChannelReplyMetadata {
                                    thread_id: thread_id.to_string(),
                                    message_id: self.message.id.to_string(),
                                    user_id: self.message.sender_id.clone(),
                                    message_content: self.message.content.clone(),
                                    thread_parent_sender_id: self.thread_parent_sender_id.clone(),
                                    common: self.channel_metadata.clone(),
                                    sender_profile_picture_url: self
                                        .sender_profile_picture_url
                                        .clone(),
                                },
                                sender_id: sender(),
                                recipient_ids: recipients_excluding(
                                    self.thread_participants.iter().map(|p| p.as_ref()),
                                    sender_and_mentions,
                                )
                                .collect(),
                            }
                            .into_request()
                            .with_apns()
                            .with_conn_gateway(),
                        )
                        .await
                        .map_err(|e| anyhow::anyhow!("{e:?}"))?;
                } else {
                    tracing::warn!("thread participants is empty, but message has thread id");
                }
            }
            // Channel has no messages, send invite notification
            (0, None) => {
                ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: entity(),
                            notification: ChannelInviteMetadata {
                                invited_by: self.message.sender_id.clone(),
                                channel_name: self.channel_metadata.channel_name.clone(),
                                sender_profile_picture_url: self.sender_profile_picture_url.clone(),
                            },
                            sender_id: sender(),
                            recipient_ids: recipients_without_sender_and_mentions,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
            // Channel has messages, send message send notification
            (_, None) => {
                ingress
                    .send_notification(
                        SendNotificationRequestBuilder {
                            notification_entity: entity(),
                            notification: ChannelMessageSendMetadata {
                                message_id: self.message.id.to_string(),
                                sender: self.message.sender_id.clone(),
                                message_content: self.message.content.to_string(),
                                common: self.channel_metadata.clone(),
                                sender_profile_picture_url: self.sender_profile_picture_url.clone(),
                            },
                            sender_id: sender(),
                            recipient_ids: recipients_without_sender_and_mentions,
                        }
                        .into_request()
                        .with_apns()
                        .with_conn_gateway(),
                    )
                    .await
                    .map_err(|e| anyhow::anyhow!("{e:?}"))?;
            }
        }

        Ok(())
    }
}

pub async fn dispatch_notifications_for_invite(
    api_context: &AppState,
    channel_id: &Uuid,
    invited_by_user_id: &MacroUserIdStr<'static>,
    recipient_user_ids: Vec<String>,
    common: CommonChannelMetadata,
) -> anyhow::Result<()> {
    let parsed_recipients: Vec<_> = recipient_user_ids
        .iter()
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .map(|u| u.0)
        .collect();

    let sender_profile_picture_url =
        get_sender_profile_picture_url(&api_context.db, invited_by_user_id).await;

    let existing_users: HashSet<String> =
        macro_db_client::user::get_all::get_existing_users(&api_context.db, &parsed_recipients)
            .await?
            .into_iter()
            .collect();

    let (existing_users, not_existing_users): (HashSet<_>, HashSet<_>) = parsed_recipients
        .into_iter()
        .map(MacroUserIdStr)
        .partition(|id| existing_users.contains(id.as_ref()));

    let _ = tokio::try_join!(
        api_context.notification_ingress_service.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url: sender_profile_picture_url.clone(),
                },
                sender_id: Some(invited_by_user_id.copied().into_owned()),
                recipient_ids: existing_users,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway(),
        ),
        api_context.notification_ingress_service.send_notification(
            SendNotificationRequestBuilder {
                notification_entity: EntityType::Channel.with_entity_string(channel_id.to_string()),
                notification: ChannelInviteMetadata {
                    invited_by: invited_by_user_id.clone(),
                    channel_name: common.channel_name.clone(),
                    sender_profile_picture_url,
                },
                sender_id: Some(invited_by_user_id.copied().into_owned()),
                recipient_ids: not_existing_users,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway(),
        )
    )
    .map_err(|e| anyhow::anyhow!("{e:?}"))?;

    Ok(())
}

pub async fn dispatch_notifications_for_message(
    api_context: &AppState,
    channel_id: &Uuid,
    channel_metadata: CommonChannelMetadata,
    participants: Vec<ChannelParticipant>,
    message: Message,
    mentions: Vec<SimpleMention>,
) -> anyhow::Result<()> {
    let channel_message_count =
        check_if_channel_has_messages(&api_context.db, channel_id).await? as usize;

    let (user_mentions, document_mention_ids) =
        mentions
            .into_iter()
            .fold((Vec::new(), Vec::new()), |(mut users, mut docs), m| {
                match m.entity_type.as_str() {
                    "user" => users.push(m.entity_id),
                    "document" => docs.push(m.entity_id),
                    _ => {}
                }
                (users, docs)
            });

    let document_mentions =
        macro_db_client::notification::get_basic_cloud_storage_documents_metadata(
            &api_context.db,
            &document_mention_ids,
        )
        .await
        .inspect_err(|e| {
            tracing::error!(error=?e, "unable to get documents metadata");
        })
        .unwrap_or_default();

    let (thread_participants, thread_parent_sender_id) = if let Some(thread_id) = message.thread_id
    {
        let participants = get_channel_participants_for_thread_id(&api_context.db, &thread_id)
            .await
            .unwrap_or_default();
        // Get the thread parent sender (author of the root message)
        let sender_id = match get_message_owner(&api_context.db, &thread_id).await {
            Ok(id) => MacroUserIdStr::parse_from_str(&id)
                .ok()
                .map(|id| id.into_owned()),
            Err(_) => None,
        };
        (participants, sender_id)
    } else {
        (vec![], None)
    };

    let sender_profile_picture_url =
        get_sender_profile_picture_url(&api_context.db, &message.sender_id).await;

    ChannelMessageEvent {
        channel_id,
        message: &message,
        channel_metadata: &channel_metadata,
        channel_message_count,
        user_mentions: &user_mentions,
        document_mentions: &document_mentions,
        participants: &participants,
        thread_participants: &thread_participants,
        thread_parent_sender_id,
        sender_profile_picture_url,
    }
    .send(&*api_context.notification_ingress_service)
    .await
}

async fn get_sender_profile_picture_url(
    db: &sqlx::PgPool,
    sender_id: &MacroUserIdStr<'_>,
) -> Option<String> {
    macro_db_client::user::update_profile_picture::get_profile_pictures(
        db,
        &vec![sender_id.as_ref().to_string()],
    )
    .await
    .ok()
    .and_then(|pics| pics.pictures.into_iter().next().map(|p| p.url))
}
