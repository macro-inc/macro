use crate::api::context::AppState;
use comms_db_client::{
    messages::get_count::check_if_channel_has_messages,
    model::{Message, SimpleMention},
    participants::get_participants::get_channel_participants_for_thread_id,
};
use model::{comms::ChannelParticipant, document_storage_service_internal::DocumentMetadata};
use model_entity::EntityType;
use model_notifications::{
    ChannelInviteMetadata, ChannelMentionMetadata, ChannelMessageSendMetadata,
    ChannelReplyMetadata, CommonChannelMetadata, DocumentMentionMetadata, NotificationEntity,
    NotificationEvent, NotificationQueueMessage,
};
use models_comms::ChannelType;
use std::{collections::HashSet, iter::once};
use uuid::Uuid;

pub struct ChannelMessageEvent<'a> {
    channel_id: &'a Uuid,
    message: &'a Message,
    channel_metadata: &'a CommonChannelMetadata,
    channel_message_count: usize,
    user_mentions: &'a [String],
    document_mentions: &'a [DocumentMetadata],
    participants: &'a [ChannelParticipant],
    thread_participants: &'a [String],
}

pub struct ChannelInviteEvent<'a> {
    channel_id: &'a Uuid,
    invited_by_user_id: &'a str,
    recipient_user_ids: &'a [String],
    common: &'a CommonChannelMetadata,
}

fn recipients_excluding<'a>(
    recipients: impl IntoIterator<Item = &'a str>,
    exclude: impl IntoIterator<Item = &'a str>,
) -> Vec<String> {
    let exclude_set: HashSet<&str> = exclude.into_iter().collect();
    recipients
        .into_iter()
        .filter(|id| !exclude_set.contains(id))
        .map(String::from)
        .collect()
}

pub fn is_channel_type_important(channel_type: &ChannelType) -> bool {
    matches!(channel_type, ChannelType::DirectMessage)
}

fn create_notification_queue_message(
    channel_id: &Uuid,
    sender_id: &str,
    recipients: &[String],
    notification_event: NotificationEvent,
    important: bool,
) -> NotificationQueueMessage {
    NotificationQueueMessage {
        notification_entity: NotificationEntity {
            event_item_id: channel_id.to_string(),
            event_item_type: EntityType::Channel,
        },
        sender_id: Some(sender_id.to_string()),
        recipient_ids: Some(recipients.to_vec()),
        notification_event,
        is_important_v0: Some(important),
    }
}

impl<'a> ChannelInviteEvent<'a> {
    fn generate_notifications(&self) -> Vec<NotificationQueueMessage> {
        let mut notifications: Vec<NotificationQueueMessage> = vec![];

        if !self.recipient_user_ids.is_empty() {
            notifications.push(create_notification_queue_message(
                self.channel_id,
                self.invited_by_user_id,
                &recipients_excluding(
                    self.recipient_user_ids.iter().map(|m| m.as_str()),
                    once(self.invited_by_user_id),
                ),
                NotificationEvent::ChannelInvite(ChannelInviteMetadata {
                    invited_by: self.invited_by_user_id.to_string(),
                    common: self.common.clone(),
                }),
                true,
            ));
        }

        notifications
    }
}

impl ChannelMessageEvent<'_> {
    fn generate_notifications(&self) -> Vec<NotificationQueueMessage> {
        let mut notifications: Vec<NotificationQueueMessage> = vec![];

        if !self.user_mentions.is_empty() {
            notifications.push(create_notification_queue_message(
                self.channel_id,
                &self.message.sender_id,
                &recipients_excluding(
                    self.user_mentions.iter().map(|m| m.as_str()),
                    once(self.message.sender_id.as_str()),
                ),
                NotificationEvent::ChannelMention(ChannelMentionMetadata {
                    message_content: self.message.content.clone(),
                    message_id: self.message.id.to_string(),
                    thread_id: self.message.thread_id.map(|t| t.to_string()),
                    common: self.channel_metadata.clone(),
                }),
                true,
            ));
        }

        if !self.document_mentions.is_empty() {
            let recipients_excluding_mentions = recipients_excluding(
                self.participants.iter().map(|p| p.user_id.as_str()),
                once(self.message.sender_id.as_str()),
            );

            for mention in self.document_mentions {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    &self.message.sender_id,
                    &recipients_excluding_mentions,
                    NotificationEvent::ChannelMessageDocument(DocumentMentionMetadata {
                        document_name: mention.item_name.clone(),
                        owner: mention.item_owner.clone(),
                        file_type: mention.file_type.clone(),
                        metadata: None,
                    }),
                    true,
                ));
            }
        }

        let sender_and_mentions = once(&self.message.sender_id)
            .chain(self.user_mentions)
            .map(String::as_str)
            .collect::<Vec<&str>>();

        // MessageSend and Invite notifications are sent to all participants except the sender and
        // mentioned users. Mentioned users receive a seperate ChannelMention Notification.
        let recipients_without_sender_and_mentions = recipients_excluding(
            self.participants.iter().map(|p| p.user_id.as_str()),
            sender_and_mentions.clone(),
        );

        match (self.channel_message_count, self.message.thread_id) {
            // Thread Message Reply
            (_, Some(thread_id)) => {
                if !self.thread_participants.is_empty() {
                    notifications.push(create_notification_queue_message(
                        self.channel_id,
                        &self.message.sender_id,
                        &recipients_excluding(
                            self.thread_participants.iter().map(|p| p.as_str()),
                            sender_and_mentions,
                        ),
                        NotificationEvent::ChannelMessageReply(ChannelReplyMetadata {
                            thread_id: thread_id.to_string(),
                            message_id: self.message.id.to_string(),
                            user_id: self.message.sender_id.clone(),
                            message_content: self.message.content.clone(),
                            common: self.channel_metadata.clone(),
                        }),
                        true,
                    ));
                } else {
                    tracing::warn!("thread participants is empty, but message has thread id");
                }
            }
            // Channel has no messages, send invite notification
            (0, None) => {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    &self.message.sender_id,
                    &recipients_without_sender_and_mentions,
                    NotificationEvent::ChannelInvite(ChannelInviteMetadata {
                        invited_by: self.message.sender_id.clone(),
                        common: self.channel_metadata.clone(),
                    }),
                    true,
                ));
            }
            // Channel has messages, send message send notification
            (_, None) => {
                notifications.push(create_notification_queue_message(
                    self.channel_id,
                    &self.message.sender_id,
                    &recipients_without_sender_and_mentions,
                    NotificationEvent::ChannelMessageSend(ChannelMessageSendMetadata {
                        message_id: self.message.id.to_string(),
                        sender: self.message.sender_id.to_string(),
                        message_content: self.message.content.to_string(),
                        common: self.channel_metadata.clone(),
                    }),
                    is_channel_type_important(&self.channel_metadata.channel_type),
                ));
            }
        }

        notifications
    }
}

pub async fn dispatch_notifications_for_invite(
    api_context: &AppState,
    channel_id: &Uuid,
    invited_by_user_id: &str,
    recipient_user_ids: Vec<String>,
    common: CommonChannelMetadata,
) -> anyhow::Result<()> {
    let event = ChannelInviteEvent {
        channel_id,
        invited_by_user_id,
        recipient_user_ids: &recipient_user_ids,
        common: &common,
    };

    let notifications = event.generate_notifications();

    for notification in notifications {
        api_context
            .macro_notify_client
            .send_notification(notification)
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

    let document_mentions = api_context
        .document_storage_service_client
        .get_documents_metadata(document_mention_ids)
        .await
        .inspect_err(|e| {
            tracing::error!("unable to get documents metadata: {e}");
        })
        .map(|response| response.documents)
        .unwrap_or_default();

    let thread_participants = if let Some(thread_id) = message.thread_id {
        get_channel_participants_for_thread_id(&api_context.db, &thread_id)
            .await
            .unwrap_or_default()
    } else {
        vec![]
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
    };

    let notifications = channel_message_event.generate_notifications();

    for notification in notifications {
        api_context
            .macro_notify_client
            .send_notification(notification)
            .await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;
    use model::comms::ParticipantRole;
    use model_notifications::NotificationEventType;
    use uuid::Uuid;

    fn participant(user_id: &str, channel_id: Uuid) -> ChannelParticipant {
        ChannelParticipant {
            user_id: user_id.to_string(),
            channel_id,
            role: ParticipantRole::Member,
            left_at: None,
            joined_at: chrono::Utc::now(),
        }
    }

    fn message(channel_id: Uuid, sender_id: &str, thread_id: Option<Uuid>) -> Message {
        Message {
            id: Uuid::new_v4(),
            sender_id: sender_id.to_string(),
            content: "test".to_string(),
            thread_id,
            channel_id,
            created_at: chrono::Utc::now(),
            deleted_at: None,
            edited_at: None,
            updated_at: chrono::Utc::now(),
        }
    }

    fn doc_metadata(name: &str) -> DocumentMetadata {
        DocumentMetadata {
            item_name: name.to_string(),
            item_owner: "owner".to_string(),
            file_type: Some("pdf".to_string()),
            item_id: "id".to_string(),
        }
    }

    fn private_metadata() -> CommonChannelMetadata {
        CommonChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: "group".to_string(),
        }
    }

    fn dm_metadata() -> CommonChannelMetadata {
        CommonChannelMetadata {
            channel_type: ChannelType::DirectMessage,
            channel_name: "dm".to_string(),
        }
    }

    // Ensures that each recipient receives only one message notification
    fn assert_single_message_notification_per_recipient(
        notifications: &[NotificationQueueMessage],
    ) {
        let mut visited: HashMap<String, Vec<NotificationEventType>> = HashMap::new();

        const MESSAGE_TYPES: &[NotificationEventType] = &[
            NotificationEventType::ChannelMessageSend,
            NotificationEventType::ChannelMessageReply,
            NotificationEventType::ChannelMention,
        ];

        for n in notifications {
            if !MESSAGE_TYPES.contains(&n.notification_event.event_type()) {
                continue;
            }
            for r in n.recipient_ids.as_ref().unwrap() {
                visited
                    .entry(r.clone())
                    .or_default()
                    .push(n.notification_event.event_type());
            }
        }

        let violations = visited
            .into_iter()
            .filter(|(_, v)| v.len() > 1)
            .collect::<Vec<_>>();

        assert!(
            violations.is_empty(),
            "notifications sent to multiple recipients: {violations:?}"
        );
    }

    #[test]
    fn sender_excluded_from_all_recipients() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
            participant("bob", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
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
        };

        let notifications = event.generate_notifications();

        assert_single_message_notification_per_recipient(&notifications);

        for n in &notifications {
            let recipients = n.recipient_ids.as_ref().unwrap();
            assert!(
                !recipients.contains(&"sender".to_string()),
                "sender should never receive their own notifications"
            );
        }
    }

    #[test]
    fn first_message_sends_invite_notification() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
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
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            notifications[0].notification_event,
            NotificationEvent::ChannelInvite(_)
        ));
    }

    #[test]
    fn subsequent_messages_send_message_send_notification() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
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
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        assert_eq!(notifications.len(), 1);
        assert!(matches!(
            notifications[0].notification_event,
            NotificationEvent::ChannelMessageSend(_)
        ));
    }

    #[test]
    fn mentioned_users_get_mention_not_message_send() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
            participant("bob", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
        let metadata = private_metadata();
        let user_mentions = vec!["alice".to_string()];

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 1,
            user_mentions: &user_mentions,
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let mention = notifications
            .iter()
            .find(|n| matches!(n.notification_event, NotificationEvent::ChannelMention(_)))
            .expect("should have mention notification");

        let mention_recipients = mention.recipient_ids.as_ref().unwrap();
        assert!(mention_recipients.contains(&"alice".to_string()));

        let send = notifications
            .iter()
            .find(|n| {
                matches!(
                    n.notification_event,
                    NotificationEvent::ChannelMessageSend(_)
                )
            })
            .expect("should have message send notification");

        let send_recipients = send.recipient_ids.as_ref().unwrap();
        assert!(!send_recipients.contains(&"alice".to_string()));
        assert!(send_recipients.contains(&"bob".to_string()));
    }

    #[test]
    fn thread_reply_excludes_sender_and_mentions() {
        let channel_id = Uuid::new_v4();
        let thread_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
            participant("bob", channel_id),
            participant("charlie", channel_id),
        ];
        let msg = message(channel_id, "sender", Some(thread_id));
        let metadata = private_metadata();
        let user_mentions = vec!["alice".to_string()];
        let thread_participants = vec![
            "sender".to_string(),
            "alice".to_string(),
            "bob".to_string(),
            "charlie".to_string(),
        ];

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 5,
            user_mentions: &user_mentions,
            document_mentions: &[],
            participants: &participants,
            thread_participants: &thread_participants,
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let reply = notifications
            .iter()
            .find(|n| {
                matches!(
                    n.notification_event,
                    NotificationEvent::ChannelMessageReply(_)
                )
            })
            .expect("should have reply notification");

        let recipients = reply.recipient_ids.as_ref().unwrap();
        assert!(!recipients.contains(&"sender".to_string()));
        assert!(!recipients.contains(&"alice".to_string()));
        assert!(recipients.contains(&"bob".to_string()));
        assert!(recipients.contains(&"charlie".to_string()));
    }

    #[test]
    fn document_mentions_exclude_sender() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
            participant("bob", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
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
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        let doc_notif = notifications
            .iter()
            .find(|n| {
                matches!(
                    n.notification_event,
                    NotificationEvent::ChannelMessageDocument(_)
                )
            })
            .expect("should have document notification");

        let recipients = doc_notif.recipient_ids.as_ref().unwrap();
        assert!(!recipients.contains(&"sender".to_string()));
        assert!(recipients.contains(&"alice".to_string()));
        assert!(recipients.contains(&"bob".to_string()));
    }

    #[test]
    fn empty_thread_participants_logs_warning() {
        let channel_id = Uuid::new_v4();
        let thread_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
        ];
        let msg = message(channel_id, "sender", Some(thread_id));
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
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        // Should not create reply notification with empty thread participants
        let has_reply = notifications.iter().any(|n| {
            matches!(
                n.notification_event,
                NotificationEvent::ChannelMessageReply(_)
            )
        });

        assert!(!has_reply);
    }

    #[test]
    fn dm_message_marked_important() {
        let channel_id = Uuid::new_v4();
        let participants = vec![
            participant("sender", channel_id),
            participant("alice", channel_id),
        ];
        let msg = message(channel_id, "sender", None);
        let metadata = dm_metadata();

        let event = ChannelMessageEvent {
            channel_id: &channel_id,
            message: &msg,
            channel_metadata: &metadata,
            channel_message_count: 2,
            user_mentions: &[],
            document_mentions: &[],
            participants: &participants,
            thread_participants: &[],
        };

        let notifications = event.generate_notifications();
        assert_single_message_notification_per_recipient(&notifications);

        assert_eq!(notifications[0].is_important_v0, Some(true));
    }
}
