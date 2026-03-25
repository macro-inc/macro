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
use model_entity::{Entity, EntityType};
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DocumentMentionMetadata, NotifEvent,
};
use notification_hex::domain::models::SendNotificationRequestBuilder;
use notification_hex::domain::service::NotificationIngress;
use std::{collections::HashSet, iter::once};
use uuid::Uuid;

struct NotificationMsg {
    notification_entity: Entity<'static>,
    notification_event: NotifEvent,
    sender_id: Option<MacroUserIdStr<'static>>,
    recipient_ids: Vec<MacroUserIdStr<'static>>,
}

pub struct ChannelMessageEvent<'a> {
    channel_id: &'a Uuid,
    message: &'a Message,
    channel_metadata: &'a CommonChannelMetadata,
    channel_message_count: usize,
    user_mentions: &'a [String],
    document_mentions: &'a [BasicCloudStorageItemMetadata],
    participants: &'a [ChannelParticipant],
    thread_participants: &'a [MacroUserIdStr<'static>],
    thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
}

pub struct ChannelInviteEvent<'a> {
    channel_id: &'a Uuid,
    invited_by_user_id: &'a MacroUserIdStr<'static>,
    recipient_user_ids: &'a [String],
    common: &'a CommonChannelMetadata,
}

fn recipients_excluding<'a>(
    recipients: impl IntoIterator<Item = &'a str>,
    exclude: impl IntoIterator<Item = &'a str>,
) -> Vec<MacroUserIdStr<'static>> {
    let exclude_set: HashSet<&str> = exclude.into_iter().collect();
    recipients
        .into_iter()
        .filter(|id| !exclude_set.contains(id))
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .map(|u| u.into_owned())
        .collect()
}

fn create_notification_queue_message(
    channel_id: &Uuid,
    sender_id: MacroUserIdStr<'static>,
    recipients: Vec<MacroUserIdStr<'static>>,
    notification_event: NotifEvent,
) -> NotificationMsg {
    NotificationMsg {
        notification_entity: EntityType::Channel.with_entity_string(channel_id.to_string()),
        sender_id: Some(sender_id),
        recipient_ids: recipients,
        notification_event,
    }
}

impl<'a> ChannelInviteEvent<'a> {
    fn generate_notifications(&self) -> Vec<NotificationMsg> {
        let mut notifications: Vec<NotificationMsg> = vec![];

        if !self.recipient_user_ids.is_empty() {
            notifications.push(create_notification_queue_message(
                self.channel_id,
                self.invited_by_user_id.copied().into_owned(),
                recipients_excluding(
                    self.recipient_user_ids.iter().map(|m| m.as_str()),
                    once(self.invited_by_user_id.as_ref()),
                ),
                NotifEvent::ChannelInvite(ChannelInviteMetadata {
                    invited_by: self.invited_by_user_id.clone(),
                    common: self.common.clone(),
                    sender_profile_picture_url: None,
                }),
            ));
        }

        notifications
    }
}

impl ChannelMessageEvent<'_> {
    fn generate_notifications(&self) -> Vec<NotificationMsg> {
        let mut notifications: Vec<NotificationMsg> = vec![];

        if !self.user_mentions.is_empty() {
            notifications.push(create_notification_queue_message(
                self.channel_id,
                self.message.sender_id.clone(),
                recipients_excluding(
                    self.user_mentions.iter().map(|m| m.as_str()),
                    once(self.message.sender_id.0.as_ref()),
                ),
                NotifEvent::ChannelMention(ChannelMentionMetadata {
                    message_content: self.message.content.clone(),
                    message_id: self.message.id.to_string(),
                    thread_id: self.message.thread_id.map(|t| t.to_string()),
                    common: self.channel_metadata.clone(),
                    sender_profile_picture_url: None,
                }),
            ));
        }

        if !self.document_mentions.is_empty() {
            let recipients_excluding_mentions = recipients_excluding(
                self.participants.iter().map(|p| p.user_id.as_ref()),
                once(self.message.sender_id.0.as_ref()),
            );

            for mention in self.document_mentions {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    self.message.sender_id.clone(),
                    recipients_excluding_mentions.clone(),
                    NotifEvent::DocumentMention(DocumentMentionMetadata {
                        document_name: mention.item_name.clone(),
                        owner: mention.item_owner.clone(),
                        file_type: mention.file_type.clone(),
                        sender_profile_picture_url: None,
                    }),
                ));
            }
        }

        let sender_and_mentions = once(self.message.sender_id.0.as_ref())
            .chain(self.user_mentions.iter().map(String::as_str))
            .collect::<Vec<&str>>();

        // MessageSend and Invite notifications are sent to all participants except the sender and
        // mentioned users. Mentioned users receive a seperate ChannelMention Notification.
        let recipients_without_sender_and_mentions = recipients_excluding(
            self.participants.iter().map(|p| p.user_id.as_ref()),
            sender_and_mentions.clone(),
        );

        match (self.channel_message_count, self.message.thread_id) {
            // Thread Message Reply
            (_, Some(thread_id)) => {
                if !self.thread_participants.is_empty() {
                    notifications.push(create_notification_queue_message(
                        self.channel_id,
                        self.message.sender_id.clone(),
                        recipients_excluding(
                            self.thread_participants.iter().map(|p| p.as_ref()),
                            sender_and_mentions,
                        ),
                        NotifEvent::ChannelMessageReply(ChannelReplyMetadata {
                            thread_id: thread_id.to_string(),
                            message_id: self.message.id.to_string(),
                            user_id: self.message.sender_id.clone(),
                            message_content: self.message.content.clone(),
                            thread_parent_sender_id: self.thread_parent_sender_id.clone(),
                            common: self.channel_metadata.clone(),
                            sender_profile_picture_url: None,
                        }),
                    ));
                } else {
                    tracing::warn!("thread participants is empty, but message has thread id");
                }
            }
            // Channel has no messages, send invite notification
            (0, None) => {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    self.message.sender_id.clone(),
                    recipients_without_sender_and_mentions.clone(),
                    NotifEvent::ChannelInvite(ChannelInviteMetadata {
                        invited_by: self.message.sender_id.clone(),
                        common: self.channel_metadata.clone(),
                        sender_profile_picture_url: None,
                    }),
                ));
            }
            // Channel has messages, send message send notification
            (_, None) => {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    self.message.sender_id.clone(),
                    recipients_without_sender_and_mentions.clone(),
                    NotifEvent::ChannelMessageSend(ChannelMessageSendMetadata {
                        message_id: self.message.id.to_string(),
                        sender: self.message.sender_id.clone(),
                        message_content: self.message.content.to_string(),
                        common: self.channel_metadata.clone(),
                        sender_profile_picture_url: None,
                    }),
                ));
            }
        }

        notifications
    }
}

async fn send_notification_queue_message(
    ingress: &impl NotificationIngress,
    msg: NotificationMsg,
) -> anyhow::Result<()> {
    let entity = msg.notification_entity;
    let sender_id = msg.sender_id;
    let recipient_ids: HashSet<MacroUserIdStr<'_>> = msg.recipient_ids.into_iter().collect();

    match msg.notification_event {
        NotifEvent::ChannelInvite(metadata) => {
            let req = SendNotificationRequestBuilder {
                notification_entity: entity,
                notification: metadata,
                sender_id,
                recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway();
            ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        NotifEvent::ChannelMessageSend(metadata) => {
            let req = SendNotificationRequestBuilder {
                notification_entity: entity,
                notification: metadata,
                sender_id,
                recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway();
            ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        NotifEvent::ChannelMention(metadata) => {
            let req = SendNotificationRequestBuilder {
                notification_entity: entity,
                notification: metadata,
                sender_id,
                recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway();
            ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        NotifEvent::ChannelMessageReply(metadata) => {
            let req = SendNotificationRequestBuilder {
                notification_entity: entity,
                notification: metadata,
                sender_id,
                recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway();
            ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        NotifEvent::DocumentMention(metadata) => {
            let req = SendNotificationRequestBuilder {
                notification_entity: entity,
                notification: metadata,
                sender_id,
                recipient_ids,
            }
            .into_request()
            .with_apns()
            .with_conn_gateway();
            ingress
                .send_notification(req)
                .await
                .map_err(|e| anyhow::anyhow!("{e}"))?;
        }
        other => {
            tracing::warn!(?other, "unhandled notification event type in comms_service");
        }
    }

    Ok(())
}

pub async fn dispatch_notifications_for_invite(
    api_context: &AppState,
    channel_id: &Uuid,
    invited_by_user_id: &MacroUserIdStr<'static>,
    recipient_user_ids: Vec<String>,
    common: CommonChannelMetadata,
) -> anyhow::Result<()> {
    let sender_profile_picture_url =
        get_sender_profile_picture_url(&api_context.db, invited_by_user_id).await;

    let event = ChannelInviteEvent {
        channel_id,
        invited_by_user_id,
        recipient_user_ids: &recipient_user_ids,
        common: &common,
    };

    let mut notifications = event.generate_notifications();
    for n in &mut notifications {
        set_sender_profile_picture(
            &mut n.notification_event,
            sender_profile_picture_url.clone(),
        );
    }

    for notification in notifications {
        send_notification_queue_message(&*api_context.notification_ingress_service, notification)
            .await?;
    }

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

    let channel_message_event = ChannelMessageEvent {
        channel_id,
        message: &message,
        channel_metadata: &channel_metadata,
        channel_message_count,
        user_mentions: &user_mentions,
        document_mentions: &document_mentions,
        participants: &participants,
        thread_participants: &thread_participants,
        thread_parent_sender_id,
    };

    let sender_profile_picture_url =
        get_sender_profile_picture_url(&api_context.db, &message.sender_id).await;

    let mut notifications = channel_message_event.generate_notifications();
    for n in &mut notifications {
        set_sender_profile_picture(
            &mut n.notification_event,
            sender_profile_picture_url.clone(),
        );
    }

    for notification in notifications {
        send_notification_queue_message(&*api_context.notification_ingress_service, notification)
            .await?;
    }

    Ok(())
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

fn set_sender_profile_picture(event: &mut NotifEvent, url: Option<String>) {
    match event {
        NotifEvent::ChannelInvite(m) => m.sender_profile_picture_url = url,
        NotifEvent::ChannelMessageSend(m) => m.sender_profile_picture_url = url,
        NotifEvent::ChannelMention(m) => m.sender_profile_picture_url = url,
        NotifEvent::ChannelMessageReply(m) => m.sender_profile_picture_url = url,
        NotifEvent::DocumentMention(m) => m.sender_profile_picture_url = url,
        NotifEvent::MentionedInDocumentComment(m) => m.sender_profile_picture_url = url,
        NotifEvent::RepliedToDocumentCommentThread(m) => m.sender_profile_picture_url = url,
        NotifEvent::CommentedOnDocument(m) => m.sender_profile_picture_url = url,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::comms::{ChannelId, ParticipantRole};
    use std::collections::HashMap;
    use uuid::Uuid;

    fn participant(user_id: MacroUserIdStr<'static>, channel_id: Uuid) -> ChannelParticipant {
        ChannelParticipant {
            user_id,
            channel_id: ChannelId(channel_id),
            role: ParticipantRole::Member,
            left_at: None,
            joined_at: chrono::Utc::now(),
        }
    }

    fn message(
        channel_id: Uuid,
        sender_id: MacroUserIdStr<'static>,
        thread_id: Option<Uuid>,
    ) -> Message {
        Message {
            id: Uuid::new_v4(),
            sender_id,
            content: "test".to_string(),
            thread_id,
            channel_id,
            created_at: chrono::Utc::now(),
            deleted_at: None,
            edited_at: None,
            updated_at: chrono::Utc::now(),
        }
    }

    fn doc_metadata(name: &str) -> BasicCloudStorageItemMetadata {
        BasicCloudStorageItemMetadata {
            item_name: name.to_string(),
            item_owner: MacroUserIdStr::parse_from_str("macro|owner@test.com")
                .unwrap()
                .into_owned(),
            file_type: Some("pdf".to_string()),
            item_id: "id".to_string(),
        }
    }

    fn private_metadata() -> CommonChannelMetadata {
        CommonChannelMetadata {
            channel_type: model_notifications::ChannelType::Private,
            channel_name: "group".to_string(),
        }
    }

    fn is_message_notification(event: &NotifEvent) -> bool {
        matches!(
            event,
            NotifEvent::ChannelMessageSend(_)
                | NotifEvent::ChannelMessageReply(_)
                | NotifEvent::ChannelMention(_)
        )
    }

    fn uid(s: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::parse_from_str(s).unwrap().into_owned()
    }

    // Ensures that each recipient receives only one message notification
    fn assert_single_message_notification_per_recipient(notifications: &[NotificationMsg]) {
        let mut visited: HashMap<MacroUserIdStr<'static>, usize> = HashMap::new();

        for n in notifications {
            if !is_message_notification(&n.notification_event) {
                continue;
            }
            for r in &n.recipient_ids {
                *visited.entry(r.clone()).or_default() += 1;
            }
        }

        let violations: Vec<_> = visited
            .into_iter()
            .filter(|(_, count)| *count > 1)
            .collect();

        assert!(
            violations.is_empty(),
            "notifications sent to multiple recipients: {violations:?}"
        );
    }

    #[test]
    fn sender_excluded_from_all_recipients() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            None,
        );
        let metadata = private_metadata();

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 1,
            user_mentions: &[],
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();

        assert_single_message_notification_per_recipient(&notifications);

        for n in &notifications {
            let recipients = &n.recipient_ids;
            assert!(
                !recipients.contains(&uid("macro|sender@test.com")),
                "sender should never receive their own notifications"
            );
        }
    }

    #[test]
    fn first_message_sends_invite_notification() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            None,
        );
        let metadata = private_metadata();

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 0,
            user_mentions: &[],
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            notifications[0].notification_event,
            NotifEvent::ChannelInvite(_)
        ));
    }

    #[test]
    fn subsequent_messages_send_message_send_notification() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            None,
        );
        let metadata = private_metadata();

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 5,
            user_mentions: &[],
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            notifications[0].notification_event,
            NotifEvent::ChannelMessageSend(_)
        ));
    }

    #[test]
    fn mentioned_users_get_mention_not_message_send() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            None,
        );
        let metadata = private_metadata();
        let user_mentions = vec!["macro|alice@test.com".to_string()];

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 1,
            user_mentions: &user_mentions,
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let mention = notifications
            .iter()
            .find(|n| matches!(n.notification_event, NotifEvent::ChannelMention(_)))
            .expect("should have mention notification");

        let mention_recipients = &mention.recipient_ids;

        assert!(mention_recipients.contains(&uid("macro|alice@test.com")));

        let send = notifications
            .iter()
            .find(|n| matches!(n.notification_event, NotifEvent::ChannelMessageSend(_)))
            .expect("should have message send notification");

        let send_recipients = &send.recipient_ids;
        assert!(!send_recipients.contains(&uid("macro|alice@test.com")));
        assert!(send_recipients.contains(&uid("macro|bob@test.com")));
    }

    #[test]
    fn thread_reply_excludes_sender_and_mentions() {
        let channel_id = Uuid::new_v4();
        let thread_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|charlie@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            Some(thread_id),
        );
        let metadata = private_metadata();
        let user_mentions = vec!["macro|alice@test.com".to_string()];
        let thread_participants = vec![
            MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|charlie@test.com").unwrap(),
        ];

        let thread_parent_sender_id = Some(
            MacroUserIdStr::parse_from_str("macro|thread_parent_sender@test.com")
                .unwrap()
                .into_owned(),
        );
        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 5,
            user_mentions: &user_mentions,
            document_mentions: &[],
            participants: &participants,
            thread_participants: &thread_participants,
            thread_parent_sender_id,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let reply = notifications
            .iter()
            .find(|n| matches!(n.notification_event, NotifEvent::ChannelMessageReply(_)))
            .expect("should have reply notification");

        let recipients = &reply.recipient_ids;
        assert!(!recipients.contains(&uid("macro|sender@test.com")));
        assert!(!recipients.contains(&uid("macro|alice@test.com")));
        assert!(recipients.contains(&uid("macro|bob@test.com")));
        assert!(recipients.contains(&uid("macro|charlie@test.com")));
    }

    #[test]
    fn document_mentions_exclude_sender() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|bob@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            None,
        );
        let metadata = private_metadata();
        let doc_mentions = vec![doc_metadata("test.pdf")];

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 1,
            user_mentions: &[],
            document_mentions: &doc_mentions,
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let doc_notif = notifications
            .iter()
            .find(|n| matches!(n.notification_event, NotifEvent::DocumentMention(_)))
            .expect("should have document notification");

        let recipients = &doc_notif.recipient_ids;
        assert!(!recipients.contains(&uid("macro|sender@test.com")));
        assert!(recipients.contains(&uid("macro|alice@test.com")));
        assert!(recipients.contains(&uid("macro|bob@test.com")));
    }

    #[test]
    fn empty_thread_participants_logs_warning() {
        let channel_id = Uuid::new_v4();
        let thread_id = Uuid::new_v4();
        let participants = vec![
            participant(
                MacroUserIdStr::parse_from_str("macro|sender@test.com").unwrap(),
                channel_id,
            ),
            participant(
                MacroUserIdStr::parse_from_str("macro|alice@test.com").unwrap(),
                channel_id,
            ),
        ];
        let msg = message(
            channel_id,
            MacroUserIdStr::parse_from_str("macro|sender@test.com")
                .unwrap()
                .into_owned(),
            Some(thread_id),
        );
        let metadata = private_metadata();

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 5,
            user_mentions: &[],
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
            thread_parent_sender_id: None,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        // Should not create reply notification with empty thread participants
        let has_reply = notifications
            .iter()
            .any(|n| matches!(n.notification_event, NotifEvent::ChannelMessageReply(_)));

        assert!(!has_reply);
    }
}
