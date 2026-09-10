use super::*;
use crate::domain::{
    models::{BotId, EntityMention, ParticipantRole, Sender},
    ports::{ChannelEventHandler, ChannelNotificationSender, ChannelSideEffectContext},
};
use chrono::Utc;
use messages::domain::{
    models::{Message, MessageAttachment, MessageParent},
    ports::{MessageChange, MessageEvent},
};
use std::sync::{Arc, Mutex};

#[derive(Clone)]
struct FakeContext {
    message_count: i64,
    fail_existing_user_lookup: bool,
    document_mentions: Vec<ChannelDocumentMention>,
    thread_context: ThreadNotificationContext,
}

impl Default for FakeContext {
    fn default() -> Self {
        Self {
            message_count: 2,
            fail_existing_user_lookup: false,
            document_mentions: Vec::new(),
            thread_context: ThreadNotificationContext::default(),
        }
    }
}

impl ChannelSideEffectContext for FakeContext {
    type Err = anyhow::Error;

    async fn get_channel_message_count(&self, _channel_id: Uuid) -> Result<i64, Self::Err> {
        Ok(self.message_count)
    }

    async fn get_existing_user_ids(
        &self,
        user_ids: Vec<MacroUserIdStr<'static>>,
    ) -> Result<HashSet<String>, Self::Err> {
        if self.fail_existing_user_lookup {
            anyhow::bail!("existing-user lookup failed");
        }
        Ok(user_ids
            .into_iter()
            .map(|user_id| user_id.as_ref().to_string())
            .collect())
    }

    async fn get_document_mentions(
        &self,
        _document_ids: Vec<String>,
    ) -> Result<Vec<ChannelDocumentMention>, Self::Err> {
        Ok(self.document_mentions.clone())
    }

    async fn get_thread_notification_context(
        &self,
        _thread_id: Uuid,
    ) -> Result<ThreadNotificationContext, Self::Err> {
        Ok(self.thread_context.clone())
    }

    async fn get_sender_profile_picture_url(
        &self,
        _sender_id: MacroUserIdStr<'static>,
    ) -> Option<String> {
        Some("https://example.com/avatar.png".to_string())
    }
}

#[derive(Clone, Default)]
struct FakeNotifications {
    effects: Arc<Mutex<Vec<ChannelNotificationEffect>>>,
}

impl ChannelNotificationSender for FakeNotifications {
    type Err = anyhow::Error;

    async fn send(&self, notification: ChannelNotificationEffect) -> Result<(), Self::Err> {
        self.effects.lock().unwrap().push(notification);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeContacts {
    users: Arc<Mutex<Vec<HashSet<MacroUserIdStr<'static>>>>>,
}

impl ChannelContactsDispatcher for FakeContacts {
    type Err = anyhow::Error;

    async fn enqueue_contacts(
        &self,
        users: HashSet<MacroUserIdStr<'static>>,
    ) -> Result<(), Self::Err> {
        self.users.lock().unwrap().push(users);
        Ok(())
    }
}

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).unwrap()
}

fn users(emails: &[&str]) -> Vec<MacroUserIdStr<'static>> {
    emails.iter().map(|email| user(email)).collect()
}

#[tokio::test]
async fn committed_message_keeps_channel_notification_policy() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let recipient = user("recipient@example.com");
    let notifications = FakeNotifications::default();
    let contacts = FakeContacts::default();
    let service =
        ChannelSideEffectService::new(FakeContext::default(), notifications.clone(), contacts);
    let now = Utc::now();

    service
        .handle({
            let mut message = hydrated_message(Message {
                id: message_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "hello".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
                parent: MessageParent::Channel(channel_id),
                mentions: vec![],
                reactions: vec![],
                attachments: vec![],
                imported_author: None,
                bot_profile: None,
            });
            let mentions: Vec<SimpleMention> = Vec::new();
            message.mentions = mentions.clone();
            message.attachments = Vec::new();
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(message.sender_id.clone()),
                    nonce: Some("nonce-1".to_string()),
                    change: MessageChange::Posted {
                        message,
                        mentions: mentions.clone(),
                        notification_policy: PostMessageNotificationPolicy::Default,
                    },
                }),
                metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                }),
                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: recipient.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
            }
        })
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::ChannelMessage {
        message_id: notified_message_id,
        sender: notified_sender,
        recipient_ids,
        metadata,
        ..
    } = &notification_effects[0]
    else {
        panic!("expected channel message notification effect");
    };
    assert_eq!(*notified_message_id, message_id);
    assert_eq!(*notified_sender, NotificationSender::User(sender.clone()));
    assert_eq!(metadata.channel_name, "Project");
    assert_eq!(recipient_ids.len(), 1);
    assert!(recipient_ids.contains(&recipient));
}

/// Build a MessagePosted event for a bot-sent message.
fn bot_message_posted_event(
    channel_id: Uuid,
    message_id: Uuid,
    thread_id: Option<Uuid>,
    participant_principals: &[&str],
) -> ChannelEvent {
    let now = Utc::now();
    {
        let mut message = hydrated_message(Message {
            id: message_id,
            thread_id: thread_id,
            sender_id: Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4())),
            triggered_by: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
            parent: MessageParent::Channel(channel_id),
            mentions: vec![],
            reactions: vec![],
            attachments: vec![],
            imported_author: None,
            bot_profile: None,
        });
        let mentions: Vec<SimpleMention> = Vec::new();
        message.mentions = mentions.clone();
        message.attachments = Vec::new();
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(channel_id),
                actor: String::from(message.sender_id.clone()),
                nonce: None,
                change: MessageChange::Posted {
                    message,
                    mentions: mentions.clone(),
                    notification_policy: PostMessageNotificationPolicy::Default,
                },
            }),
            metadata: Some(ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Project".to_string(),
            }),
            participants: participant_principals
                .iter()
                .map(|principal| ChannelParticipant {
                    channel_id,
                    user_id: principal.to_string(),
                    role: ParticipantRole::Member,
                    joined_at: now,
                    left_at: None,
                })
                .collect(),
        }
    }
}

#[tokio::test]
async fn silent_message_posted_skips_notifications_only() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let recipient = user("recipient@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        notifications.clone(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle({
            let mut message = hydrated_message(Message {
                id: message_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "transient".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
                parent: MessageParent::Channel(channel_id),
                mentions: vec![],
                reactions: vec![],
                attachments: vec![],
                imported_author: None,
                bot_profile: None,
            });
            let mentions: Vec<SimpleMention> = Vec::new();
            message.mentions = mentions.clone();
            message.attachments = Vec::new();
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(message.sender_id.clone()),
                    nonce: None,
                    change: MessageChange::Posted {
                        message,
                        mentions: mentions.clone(),
                        notification_policy: PostMessageNotificationPolicy::Silent,
                    },
                }),
                metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                }),
                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: recipient.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
            }
        })
        .await;

    assert!(notifications.effects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mentions_only_skips_failing_invite_lookup_and_sends_mention() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("julia@example.com");
    let mentioned = user("new-user@example.com");
    let jacob = user("jacob@example.com");
    let teo = user("teo@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            message_count: 1,
            fail_existing_user_lookup: true,
            ..FakeContext::default()
        },
        notifications.clone(),
        FakeContacts::default(),
    );
    let now = Utc::now();
    let participants = [&sender, &mentioned, &jacob, &teo]
        .into_iter()
        .map(|user_id| ChannelParticipant {
            channel_id,
            user_id: user_id.as_ref().to_string(),
            role: ParticipantRole::Member,
            joined_at: now,
            left_at: None,
        })
        .collect();

    service
        .handle({
            let mut message = hydrated_message(Message {
                id: message_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "welcome".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
                parent: MessageParent::Channel(channel_id),
                mentions: vec![],
                reactions: vec![],
                attachments: vec![],
                imported_author: None,
                bot_profile: None,
            });
            let mentions: Vec<SimpleMention> = vec![SimpleMention::user(&mentioned)];
            message.mentions = mentions.clone();
            message.attachments = Vec::new();
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(message.sender_id.clone()),
                    nonce: None,
                    change: MessageChange::Posted {
                        message,
                        mentions: mentions.clone(),
                        notification_policy: PostMessageNotificationPolicy::MentionsOnly,
                    },
                }),
                metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Macro Support".to_string(),
                }),
                participants: participants,
            }
        })
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::UserMention { recipient_ids, .. } = &notification_effects[0]
    else {
        panic!("expected only a user mention notification");
    };
    assert_eq!(recipient_ids, &HashSet::from([mentioned]));
}

#[tokio::test]
async fn message_changed_with_posted_notification_context_sends_notification() {
    let channel_id = Uuid::new_v4();
    let thread_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let parent_sender = user("parent@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            thread_context: ThreadNotificationContext {
                participants: vec![recipient.clone(), parent_sender.clone()],
                parent_sender_id: Some(parent_sender.clone()),
            },
            ..FakeContext::default()
        },
        notifications.clone(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle({ let mut message = hydrated_message(Message { id: message_id, thread_id: Some(thread_id), sender_id: Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID), triggered_by: None, content: "final answer".to_string(), created_at: now, updated_at: now, edited_at: Some(now), deleted_at: None, parent: MessageParent::Channel(channel_id), mentions: vec![], reactions: vec![], attachments: vec![], imported_author: None, bot_profile: None }); let mentions: Vec<SimpleMention> = Vec::new(); message.mentions = mentions.clone(); message.attachments = vec![]; ChannelEvent::MessageCommitted { event: Box::new(MessageEvent { parent: MessageParent::Channel(channel_id), actor: String::from(Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID)), nonce: None, change: MessageChange::Edited { message, mentions: mentions.clone(), previous_attachments: vec![], notification_policy: messages::domain::models::PatchMessageNotificationPolicy::NotifyAsPostedMessage } }), metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                }), participants: Vec::new() } })
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::Reply {
        message_id: notified_message_id,
        sender,
        recipient_ids,
        ..
    } = &notification_effects[0]
    else {
        panic!("expected reply notification effect");
    };
    assert_eq!(*notified_message_id, message_id);
    assert_eq!(
        *sender,
        NotificationSender::Bot {
            name: bot_id::MACRO_AI_NAME.to_string()
        }
    );
    assert!(recipient_ids.contains(&recipient));
    assert!(recipient_ids.contains(&parent_sender));
}

#[tokio::test]
async fn bot_message_posted_sends_channel_message_notification() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(bot_message_posted_event(
            channel_id,
            message_id,
            None,
            &[recipient.as_ref()],
        ))
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::ChannelMessage {
        sender,
        sender_profile_picture_url,
        recipient_ids,
        ..
    } = &notification_effects[0]
    else {
        panic!("expected channel message notification effect");
    };
    assert_eq!(
        *sender,
        NotificationSender::Bot {
            name: "Test Bot".to_string()
        }
    );
    assert_eq!(
        sender_profile_picture_url.as_deref(),
        Some("https://example.com/bot.png")
    );
    assert_eq!(recipient_ids.len(), 1);
    assert!(recipient_ids.contains(&recipient));
}

#[tokio::test]
async fn bot_message_without_profile_skips_notifications() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    let mut event = bot_message_posted_event(channel_id, message_id, None, &[recipient.as_ref()]);
    if let ChannelEvent::MessageCommitted { event, .. } = &mut event
        && let MessageChange::Posted { message, .. } = &mut event.change
    {
        message.bot_profile = None;
    }
    service.handle(event).await;

    assert!(notifications.effects.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_first_message_sends_channel_message_not_invite() {
    let channel_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            message_count: 1,
            ..FakeContext::default()
        },
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(bot_message_posted_event(
            channel_id,
            Uuid::new_v4(),
            None,
            &[recipient.as_ref()],
        ))
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    assert!(matches!(
        &notification_effects[0],
        ChannelNotificationEffect::ChannelMessage { .. }
    ));
}

#[tokio::test]
async fn bot_thread_reply_sends_reply_notification() {
    let channel_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let parent_sender = user("parent@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            thread_context: ThreadNotificationContext {
                participants: vec![recipient.clone(), parent_sender.clone()],
                parent_sender_id: Some(parent_sender.clone()),
            },
            ..FakeContext::default()
        },
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(bot_message_posted_event(
            channel_id,
            Uuid::new_v4(),
            Some(Uuid::new_v4()),
            &[recipient.as_ref(), parent_sender.as_ref()],
        ))
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::Reply {
        sender,
        thread_parent_sender_id,
        recipient_ids,
        ..
    } = &notification_effects[0]
    else {
        panic!("expected reply notification effect");
    };
    assert_eq!(
        *sender,
        NotificationSender::Bot {
            name: "Test Bot".to_string()
        }
    );
    assert_eq!(*thread_parent_sender_id, Some(parent_sender.clone()));
    assert!(recipient_ids.contains(&recipient));
    assert!(recipient_ids.contains(&parent_sender));
}

#[tokio::test]
async fn bot_participant_is_never_a_notification_recipient() {
    let channel_id = Uuid::new_v4();
    let recipient = user("recipient@example.com");
    let bot_principal = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        notifications.clone(),
        FakeContacts::default(),
    );

    service
        .handle(bot_message_posted_event(
            channel_id,
            Uuid::new_v4(),
            None,
            &[recipient.as_ref(), bot_principal.as_str()],
        ))
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    assert_eq!(notification_effects.len(), 1);
    let ChannelNotificationEffect::ChannelMessage { recipient_ids, .. } = &notification_effects[0]
    else {
        panic!("expected channel message notification effect");
    };
    assert_eq!(recipient_ids.len(), 1);
    assert!(recipient_ids.contains(&recipient));
}

#[tokio::test]
async fn document_mentions_notify_participants_except_sender() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let mentioned = user("mentioned@example.com");
    let other = user("other@example.com");
    let notifications = FakeNotifications::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            document_mentions: vec![ChannelDocumentMention {
                document_name: "Spec".to_string(),
                owner: sender.clone(),
                file_type: None,
                sub_type: None,
            }],
            ..FakeContext::default()
        },
        notifications.clone(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle({
            let mut message = hydrated_message(Message {
                id: message_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "hello".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
                parent: MessageParent::Channel(channel_id),
                mentions: vec![],
                reactions: vec![],
                attachments: vec![],
                imported_author: None,
                bot_profile: None,
            });
            let mentions: Vec<SimpleMention> = vec![
                SimpleMention {
                    entity_type: "user".to_string(),
                    entity_id: mentioned.as_ref().to_string(),
                },
                SimpleMention {
                    entity_type: "document".to_string(),
                    entity_id: "doc-1".to_string(),
                },
            ];
            message.mentions = mentions.clone();
            message.attachments = Vec::new();
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(message.sender_id.clone()),
                    nonce: None,
                    change: MessageChange::Posted {
                        message,
                        mentions: mentions.clone(),
                        notification_policy: PostMessageNotificationPolicy::Default,
                    },
                }),
                metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                }),
                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: mentioned.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: other.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
            }
        })
        .await;

    let notification_effects = notifications.effects.lock().unwrap();
    let document_recipients = notification_effects
        .iter()
        .find_map(|effect| match effect {
            ChannelNotificationEffect::DocumentMention { recipient_ids, .. } => Some(recipient_ids),
            _ => None,
        })
        .expect("expected document mention notification");
    assert!(document_recipients.contains(&mentioned));
    assert!(document_recipients.contains(&other));
    assert!(!document_recipients.contains(&sender));
}

#[test]
fn contact_sync_is_derived_from_private_channel_created() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_user(user("alice@example.com")),
        on_behalf_of: None,
        channel_type: ChannelType::Private,
        channel_name: None,
        participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
    };

    let contact_users = contact_sync_users_for_event(&event).unwrap();

    assert_eq!(contact_users.len(), 2);
    assert!(contact_users.contains(&user("alice@example.com")));
    assert!(contact_users.contains(&user("bob@example.com")));
}

#[test]
fn contact_sync_system_channel_created_with_subject() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        on_behalf_of: Some(user("owner@example.com")),
        channel_type: ChannelType::Private,
        channel_name: Some("Macro Support x owner".to_string()),
        participant_user_ids: users(&["owner@example.com", "teo@macro.com"]),
    };

    let contact_users = contact_sync_users_for_event(&event).unwrap();

    assert_eq!(contact_users.len(), 2);
    assert!(contact_users.contains(&user("owner@example.com")));
    assert!(contact_users.contains(&user("teo@macro.com")));
}

#[test]
fn contact_sync_ignores_bot_channel_created_without_subject() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_bot(bot_id::MACRO_SYSTEM_BOT_ID),
        on_behalf_of: None,
        channel_type: ChannelType::Private,
        channel_name: None,
        participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
    };

    assert!(contact_sync_users_for_event(&event).is_none());
}

#[test]
fn contact_sync_ignores_public_channel_created() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_user(user("alice@example.com")),
        on_behalf_of: None,
        channel_type: ChannelType::Public,
        channel_name: None,
        participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
    };

    assert!(contact_sync_users_for_event(&event).is_none());
}

#[test]
fn contact_sync_ignores_bot_actor() {
    let event = ChannelEvent::ParticipantsAdded {
        channel_id: Uuid::nil(),
        channel_type: ChannelType::Team,
        active_participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        invited_by: Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4())),
        recipient_user_ids: users(&["bob@example.com"]),
        metadata: ChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "team".to_string(),
        },
        message_content: None,
    };

    assert!(contact_sync_users_for_event(&event).is_none());
}

#[test]
fn contact_sync_is_derived_from_team_participants_added() {
    let event = ChannelEvent::ParticipantsAdded {
        channel_id: Uuid::nil(),
        channel_type: ChannelType::Team,
        active_participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        invited_by: Sender::new_from_user(user("alice@example.com")),
        recipient_user_ids: users(&["bob@example.com"]),
        metadata: ChannelMetadata {
            channel_type: ChannelType::Team,
            channel_name: "team".to_string(),
        },
        message_content: None,
    };

    assert_eq!(contact_sync_users_for_event(&event).unwrap().len(), 2);
}

#[test]
fn contact_sync_ignores_single_user_join() {
    let event = ChannelEvent::ParticipantJoined {
        channel_id: Uuid::nil(),
        channel_type: ChannelType::Public,
        user_id: Sender::new_from_user(user("alice@example.com")),
        active_participant_user_ids: users(&["alice@example.com"]),
    };

    assert!(contact_sync_users_for_event(&event).is_none());
}

fn mention(entity_type: &str, entity_id: &str) -> SimpleMention {
    SimpleMention {
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
    }
}

#[test]
fn bot_mentions_recognize_bot_and_macro_ai_user_tags() {
    let macro_ai = bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string();
    let other_bot = BotId::new_from_uuid(Uuid::new_v4());
    let other_bot_principal = other_bot.into_storage_id().to_string();
    let mentions = vec![
        // Macro AI surfaced through the user-mention UI.
        mention("user", &macro_ai),
        // Duplicate bot mentions are dispatched once.
        mention("user", &macro_ai),
        // A real user mention is ignored.
        mention("user", "macro|teo@macro.com"),
        // An explicitly bot-tagged mention.
        mention(BOT_MENTION_ENTITY_TYPE, &other_bot_principal),
        mention(BOT_MENTION_ENTITY_TYPE, &other_bot_principal),
    ];

    let bots = bot_mention_ids(&mentions);
    assert_eq!(bots, vec![bot_id::MACRO_AI_BOT_ID, other_bot]);
}

#[test]
fn bot_mentions_reject_bare_uuid_ids() {
    // Bare UUIDs are a legacy encoding; producers must send `bot|<uuid>`
    // and historical content is normalized by migration.
    let mentions = vec![
        mention("user", &bot_id::MACRO_AI_BOT_ID.as_uuid().to_string()),
        mention(BOT_MENTION_ENTITY_TYPE, &Uuid::new_v4().to_string()),
    ];

    assert!(bot_mention_ids(&mentions).is_empty());
}

#[test]
fn macro_ai_user_mention_is_not_a_user_recipient() {
    assert!(is_bot_user_mention(&mention(
        "user",
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    )));
    // The legacy bare-UUID encoding is no longer treated as a bot mention.
    assert!(!is_bot_user_mention(&mention(
        "user",
        &bot_id::MACRO_AI_BOT_ID.as_uuid().to_string()
    )));
    assert!(!is_bot_user_mention(&mention(
        "user",
        "macro|teo@macro.com"
    )));
    assert!(is_bot_principal(
        bot_id::MACRO_AI_BOT_ID.into_storage_id().as_ref()
    ));
    assert!(!is_bot_principal("macro|teo@macro.com"));
}

#[derive(Clone, Default)]
struct TestEventBroker {
    published: Arc<Mutex<Vec<PublishedEvent>>>,
}

#[derive(Debug, Clone)]
struct PublishedEvent {
    topic: String,
    key: String,
    envelope: serde_json::Value,
}

impl MacroEventBroker for TestEventBroker {
    fn send_event<E: macro_event_broker::MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic().to_string(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

fn broker_service(
    broker: TestEventBroker,
) -> ChannelSideEffectService<FakeContext, FakeNotifications, FakeContacts, TestEventBroker> {
    ChannelSideEffectService::new(
        FakeContext::default(),
        FakeNotifications::default(),
        FakeContacts::default(),
    )
    .with_macro_event_broker(broker)
}

fn attachment(_channel_id: Uuid, _message_id: Uuid) -> MessageAttachment {
    MessageAttachment {
        id: Uuid::new_v4(),
        entity_type: "document".to_string(),
        entity_id: "doc-1".to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    }
}

fn channel_message(channel_id: Uuid, message_id: Uuid) -> Message {
    let now = Utc::now();
    hydrated_message(Message {
        id: message_id,
        thread_id: None,
        sender_id: Sender::new_from_user(user("alice@example.com")),
        triggered_by: None,
        content: "updated message".to_string(),
        created_at: now,
        updated_at: now,
        edited_at: Some(now),
        deleted_at: None,
        parent: MessageParent::Channel(channel_id),
        mentions: vec![],
        reactions: vec![],
        attachments: vec![],
        imported_author: None,
        bot_profile: None,
    })
}

#[tokio::test]
async fn handle_publishes_channel_created_event() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());
    let channel_id = Uuid::new_v4();

    service
        .handle(ChannelEvent::ChannelCreated {
            channel_id,
            actor: Sender::new_from_user(user("alice@example.com")),
            on_behalf_of: None,
            channel_type: ChannelType::Private,
            channel_name: Some("general".to_string()),
            participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].topic, "macro.channels");
    assert_eq!(published[0].key, channel_id.to_string());
    assert_eq!(published[0].envelope["event_type"], "channel.created");
    assert_eq!(published[0].envelope["metadata"]["channel_name"], "general");
    assert_eq!(
        published[0].envelope["metadata"]["actor"],
        "macro|alice@example.com"
    );
}

#[tokio::test]
async fn handle_publishes_message_posted_and_attachment_created_events() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let now = Utc::now();

    service
        .handle({
            let mut message = hydrated_message(Message {
                id: message_id,
                thread_id: None,
                sender_id: Sender::new_from_user(user("alice@example.com")),
                triggered_by: None,
                content: "hello world".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
                parent: MessageParent::Channel(channel_id),
                mentions: vec![],
                reactions: vec![],
                attachments: vec![],
                imported_author: None,
                bot_profile: None,
            });
            let mentions: Vec<SimpleMention> = Vec::new();
            message.mentions = mentions.clone();
            message.attachments = vec![attachment(channel_id, message_id)];
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(message.sender_id.clone()),
                    nonce: None,
                    change: MessageChange::Posted {
                        message,
                        mentions: mentions.clone(),
                        notification_policy: PostMessageNotificationPolicy::Default,
                    },
                }),
                metadata: Some(ChannelMetadata {
                    channel_type: ChannelType::Team,
                    channel_name: "Project".to_string(),
                }),
                participants: Vec::new(),
            }
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 2);
    assert_eq!(
        published[0].envelope["event_type"],
        "channel.message_posted"
    );
    assert_eq!(published[0].envelope["metadata"]["content"], "hello world");
    assert_eq!(published[0].envelope["metadata"]["channel_type"], "team");
    assert_eq!(
        published[1].envelope["event_type"],
        "channel.message_attachment_created"
    );
    assert_eq!(
        published[1].envelope["metadata"]["attachments"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    for event in published.iter() {
        assert_eq!(event.key, channel_id.to_string());
    }
}

#[tokio::test]
async fn handle_publishes_attachment_deltas() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let added = attachment(channel_id, message_id);
    let removed = attachment(channel_id, message_id);

    service
        .handle({
            let mut message = channel_message(channel_id, message_id);
            let mentions: Vec<SimpleMention> = vec![];
            message.mentions = mentions.clone();
            message.attachments = vec![added.clone()];
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(Sender::new_from_user(user("alice@example.com"))),
                    nonce: None,
                    change: MessageChange::Edited {
                        message,
                        mentions: vec![],
                        previous_attachments: vec![removed.clone()],
                        notification_policy: Default::default(),
                    },
                }),
                metadata: None,
                participants: vec![],
            }
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 3);
    assert_eq!(
        published[1].envelope["event_type"],
        "channel.message_attachment_created"
    );
    assert_eq!(
        published[1].envelope["metadata"]["attachments"][0]["attachment_id"],
        added.id.to_string()
    );
    assert_eq!(
        published[2].envelope["event_type"],
        "channel.message_attachment_removed"
    );
    assert_eq!(
        published[2].envelope["metadata"]["attachments"][0]["attachment_id"],
        removed.id.to_string()
    );
}

#[tokio::test]
async fn handle_publishes_message_patch_and_delete_events() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let actor = Sender::new_from_user(user("alice@example.com"));
    let patched_message = channel_message(channel_id, message_id);
    let mut deleted_message = patched_message.clone();
    deleted_message.deleted_at = Some(Utc::now());

    service
        .handle({
            let mut message = patched_message;
            let mentions: Vec<SimpleMention> = vec![];
            message.mentions = mentions.clone();
            message.attachments = vec![];
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(actor.clone()),
                    nonce: None,
                    change: MessageChange::Edited {
                        message,
                        mentions: mentions.clone(),
                        previous_attachments: vec![],
                        notification_policy: Default::default(),
                    },
                }),
                metadata: None,
                participants: vec![],
            }
        })
        .await;
    service
        .handle({
            let mut message = deleted_message;
            let mentions: Vec<SimpleMention> = vec![];
            message.mentions = mentions.clone();
            message.attachments = vec![];
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(channel_id),
                    actor: String::from(actor.clone()),
                    nonce: None,
                    change: MessageChange::MessageDeleted { message },
                }),
                metadata: None,
                participants: vec![],
            }
        })
        .await;
    service
        .handle(ChannelEvent::ChannelDeleted { channel_id, actor })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 3);
    assert_eq!(
        published[0].envelope["event_type"],
        "channel.message_patched"
    );
    assert_eq!(
        published[1].envelope["event_type"],
        "channel.message_deleted"
    );
    assert_eq!(published[2].envelope["event_type"], "channel.deleted");
    assert_eq!(
        published[0].envelope["metadata"]["message_id"],
        message_id.to_string()
    );
    assert_eq!(
        published[1].envelope["metadata"]["message_id"],
        message_id.to_string()
    );
    for event in published.iter() {
        assert_eq!(event.topic, "macro.channels");
        assert_eq!(event.key, channel_id.to_string());
    }
}

#[tokio::test]
async fn handle_publishes_participant_events() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());
    let channel_id = Uuid::new_v4();

    service
        .handle(ChannelEvent::ParticipantsRemoved {
            channel_id,
            channel_type: ChannelType::Team,
            actor: user("admin@example.com"),
            removed_user_ids: users(&["bob@example.com"]),
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0].envelope["event_type"],
        "channel.participant_removed"
    );
    assert_eq!(
        published[0].envelope["metadata"]["removed_by"],
        "macro|admin@example.com"
    );
    assert_eq!(
        published[0].envelope["metadata"]["removed_user_ids"][0],
        "macro|bob@example.com"
    );
}

#[tokio::test]
async fn handle_publishes_nothing_for_typing() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());

    service
        .handle({
            let mut message = channel_message(Uuid::new_v4(), Uuid::new_v4());
            let mentions: Vec<SimpleMention> = vec![];
            message.mentions = mentions.clone();
            message.attachments = vec![];
            ChannelEvent::MessageCommitted {
                event: Box::new(MessageEvent {
                    parent: MessageParent::Channel(Uuid::new_v4()),
                    actor: String::from(Sender::new_from_user(user("alice@example.com"))),
                    nonce: None,
                    change: MessageChange::Typing {
                        thread_id: None,
                        active: true,
                    },
                }),
                metadata: None,
                participants: vec![],
            }
        })
        .await;

    assert!(broker.published.lock().unwrap().is_empty());
}

#[test]
fn broker_events_map_participant_joined_to_participant_added() {
    use macro_event_broker::MacroEvent as _;
    let channel_id = Uuid::new_v4();
    let events = broker_events_for_event(&ChannelEvent::ParticipantJoined {
        channel_id,
        channel_type: ChannelType::Public,
        user_id: Sender::new_from_user(user("alice@example.com")),
        active_participant_user_ids: users(&["alice@example.com"]),
    });

    assert_eq!(events.len(), 1);
    let envelope = serde_json::to_value(events[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "channel.participant_added");
    assert_eq!(envelope["metadata"]["added_by"], "macro|alice@example.com");
    assert_eq!(
        envelope["metadata"]["added_user_ids"][0],
        "macro|alice@example.com"
    );
}

#[test]
fn broker_events_map_channel_updated() {
    use macro_event_broker::MacroEvent as _;
    let channel_id = Uuid::new_v4();
    let events = broker_events_for_event(&ChannelEvent::ChannelUpdated {
        channel_id,
        actor: user("alice@example.com"),
        previous_name: Some("old".to_string()),
        channel_name: Some("new".to_string()),
    });

    assert_eq!(events.len(), 1);
    let envelope = serde_json::to_value(events[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "channel.updated");
    assert_eq!(envelope["metadata"]["previous_name"], "old");
    assert_eq!(envelope["metadata"]["channel_name"], "new");
}

/// Build a MessagePosted event from the given sender carrying the given
/// mentions.
fn message_posted_with_mentions(
    sender: Sender,
    channel_id: Uuid,
    message_id: Uuid,
    mentions: Vec<SimpleMention>,
    participant_principals: &[&str],
) -> ChannelEvent {
    let now = Utc::now();
    {
        let mut message = hydrated_message(Message {
            id: message_id,
            thread_id: None,
            sender_id: sender,
            triggered_by: None,
            content: "hello bots".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
            parent: MessageParent::Channel(channel_id),
            mentions: vec![],
            reactions: vec![],
            attachments: vec![],
            imported_author: None,
            bot_profile: None,
        });
        let mentions: Vec<SimpleMention> = mentions;
        message.mentions = mentions.clone();
        message.attachments = Vec::new();
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(channel_id),
                actor: String::from(message.sender_id.clone()),
                nonce: None,
                change: MessageChange::Posted {
                    message,
                    mentions: mentions.clone(),
                    notification_policy: PostMessageNotificationPolicy::Default,
                },
            }),
            metadata: Some(ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "Project".to_string(),
            }),
            participants: participant_principals
                .iter()
                .map(|principal| ChannelParticipant {
                    channel_id,
                    user_id: principal.to_string(),
                    role: ParticipantRole::Member,
                    joined_at: now,
                    left_at: None,
                })
                .collect(),
        }
    }
}

#[test]
fn broker_events_map_message_posted_mentions_per_entity() {
    use macro_event_broker::MacroEvent as _;
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let bot_principal = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();
    let macro_ai_principal = bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string();
    let macro_coder_principal = bot_id::MACRO_CODER_BOT_ID.into_storage_id().to_string();
    let uninstalled_bot_principal = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();

    let events = broker_events_for_event(&message_posted_with_mentions(
        Sender::new_from_user(user("alice@example.com")),
        channel_id,
        message_id,
        vec![
            mention(BOT_MENTION_ENTITY_TYPE, &bot_principal),
            // Duplicate mentions of one entity emit a single event.
            mention(BOT_MENTION_ENTITY_TYPE, &bot_principal),
            // Macro AI surfaced through the user-mention UI still counts.
            mention("user", &macro_ai_principal),
            // Macro Coder is globally available without a participant row.
            mention(BOT_MENTION_ENTITY_TYPE, &macro_coder_principal),
            // A valid bot principal that is not installed emits nothing.
            mention(BOT_MENTION_ENTITY_TYPE, &uninstalled_bot_principal),
            // A bot-tagged mention with a malformed id emits nothing.
            mention(BOT_MENTION_ENTITY_TYPE, "not-a-bot-principal"),
            // The sender mentioning themselves emits like any other mention.
            mention("user", "macro|alice@example.com"),
            // User and document mentions emit like any other entity.
            mention("user", "macro|bob@example.com"),
            mention("document", "doc-1"),
        ],
        // System bots need no participant rows: they are available in every
        // channel.
        &[bot_principal.as_str()],
    ));

    let posted = serde_json::to_value(events[0].event()).unwrap();
    assert_eq!(posted["event_type"], "channel.message_posted");

    let mentioned: Vec<_> = events[1..]
        .iter()
        .map(|event| serde_json::to_value(event.event()).unwrap())
        .collect();
    for envelope in &mentioned {
        assert_eq!(envelope["event_type"], "channel.mentioned");
        assert_eq!(envelope["metadata"]["channel_id"], channel_id.to_string());
        assert_eq!(envelope["metadata"]["message_id"], message_id.to_string());
        assert_eq!(envelope["metadata"]["sender"], "macro|alice@example.com");
    }
    let mentioned_entities: Vec<_> = mentioned
        .iter()
        .map(|envelope| {
            (
                envelope["metadata"]["mentioned"]["entity_type"]
                    .as_str()
                    .unwrap()
                    .to_string(),
                envelope["metadata"]["mentioned"]["entity_id"]
                    .as_str()
                    .unwrap()
                    .to_string(),
            )
        })
        .collect();
    assert_eq!(
        mentioned_entities,
        vec![
            ("bot".to_string(), bot_principal),
            ("user".to_string(), macro_ai_principal),
            ("bot".to_string(), macro_coder_principal),
            ("user".to_string(), "macro|alice@example.com".to_string()),
            ("user".to_string(), "macro|bob@example.com".to_string()),
            ("document".to_string(), "doc-1".to_string()),
        ]
    );
    assert_eq!(events[1].key(), channel_id.to_string());
}

#[test]
fn broker_events_bot_authored_mentions_emit() {
    use macro_event_broker::MacroEvent as _;
    let sender_bot = BotId::new_from_uuid(Uuid::new_v4());
    let sender_principal = sender_bot.into_storage_id().to_string();
    let other_bot_principal = BotId::new_from_uuid(Uuid::new_v4())
        .into_storage_id()
        .to_string();

    let events = broker_events_for_event(&message_posted_with_mentions(
        Sender::new_from_bot(sender_bot),
        Uuid::new_v4(),
        Uuid::new_v4(),
        vec![
            // Bot-authored mentions emit like any other, including a bot
            // mentioning itself — the pipe reports facts, consumers filter.
            mention(BOT_MENTION_ENTITY_TYPE, &sender_principal),
            mention(BOT_MENTION_ENTITY_TYPE, &other_bot_principal),
        ],
        &[sender_principal.as_str(), other_bot_principal.as_str()],
    ));

    assert_eq!(events.len(), 3);
    let self_mention = serde_json::to_value(events[1].event()).unwrap();
    assert_eq!(self_mention["event_type"], "channel.mentioned");
    assert_eq!(
        self_mention["metadata"]["mentioned"]["entity_id"],
        sender_principal
    );
    let other = serde_json::to_value(events[2].event()).unwrap();
    assert_eq!(
        other["metadata"]["mentioned"]["entity_id"],
        other_bot_principal
    );
    assert_eq!(other["metadata"]["sender"], sender_principal);
}

#[test]
fn broker_events_skip_mentions_on_message_changed() {
    use macro_event_broker::MacroEvent as _;
    let channel_id = Uuid::new_v4();
    let now = Utc::now();

    let events = broker_events_for_event(&{
        let mut message = hydrated_message(Message {
            id: Uuid::new_v4(),
            thread_id: None,
            sender_id: Sender::new_from_user(user("alice@example.com")),
            triggered_by: None,
            content: "edited to mention a bot".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: Some(now),
            deleted_at: None,
            parent: MessageParent::Channel(channel_id),
            mentions: vec![],
            reactions: vec![],
            attachments: vec![],
            imported_author: None,
            bot_profile: None,
        });
        let mentions: Vec<SimpleMention> = vec![mention(
            BOT_MENTION_ENTITY_TYPE,
            &BotId::new_from_uuid(Uuid::new_v4())
                .into_storage_id()
                .to_string(),
        )];
        message.mentions = mentions.clone();
        message.attachments = vec![];
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(channel_id),
                actor: String::from(Sender::new_from_user(user("alice@example.com"))),
                nonce: None,
                change: MessageChange::Edited {
                    message,
                    mentions: mentions.clone(),
                    previous_attachments: vec![],
                    notification_policy:
                        messages::domain::models::PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                },
            }),
            metadata: Some(ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "Project".to_string(),
            }),
            participants: Vec::new(),
        }
    });

    assert_eq!(events.len(), 1);
    let envelope = serde_json::to_value(events[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "channel.message_patched");
}

#[test]
fn broker_events_skip_reaction_changes() {
    let events = broker_events_for_event(&{
        let mut message = channel_message(Uuid::new_v4(), Uuid::new_v4());
        let mentions: Vec<SimpleMention> = vec![];
        message.mentions = mentions.clone();
        message.attachments = vec![];
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(Uuid::new_v4()),
                actor: String::from(Sender::new_from_user(user("alice@example.com"))),
                nonce: None,
                change: MessageChange::ReactionChanged { message },
            }),
            metadata: None,
            participants: vec![],
        }
    });

    assert!(events.is_empty());
}

fn entity_mention(entity_type: &str, entity_id: &str) -> EntityMention {
    EntityMention {
        id: Uuid::new_v4(),
        source_entity_type: "document".to_string(),
        source_entity_id: "doc-1".to_string(),
        entity_type: entity_type.to_string(),
        entity_id: entity_id.to_string(),
        user_id: Some("macro|alice@example.com".to_string()),
        created_at: Utc::now(),
    }
}

#[test]
fn broker_events_skip_entity_mention_events() {
    assert!(
        broker_events_for_event(&ChannelEvent::EntityMentionCreated {
            mention: entity_mention("bot", "bot-1"),
        })
        .is_empty()
    );
    assert!(
        broker_events_for_event(&ChannelEvent::EntityMentionDeleted {
            mention: entity_mention("bot", "bot-1"),
        })
        .is_empty()
    );
}

#[test]
fn mention_broker_events_map_message_posted_mentions() {
    use macro_event_broker::MacroEvent as _;
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let now = Utc::now();

    let events = mention_broker_events_for_event(&{
        let mut message = hydrated_message(Message {
            id: message_id,
            thread_id: None,
            sender_id: Sender::new_from_user(user("alice@example.com")),
            triggered_by: None,
            content: "@bot @doc-1".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
            parent: MessageParent::Channel(channel_id),
            mentions: vec![],
            reactions: vec![],
            attachments: vec![],
            imported_author: None,
            bot_profile: None,
        });
        let mentions: Vec<SimpleMention> = vec![
            SimpleMention {
                entity_type: "bot".to_string(),
                entity_id: "bot-1".to_string(),
            },
            SimpleMention {
                entity_type: "document".to_string(),
                entity_id: "doc-1".to_string(),
            },
        ];
        message.mentions = mentions.clone();
        message.attachments = Vec::new();
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(channel_id),
                actor: String::from(message.sender_id.clone()),
                nonce: None,
                change: MessageChange::Posted {
                    message,
                    mentions: mentions.clone(),
                    notification_policy: PostMessageNotificationPolicy::Default,
                },
            }),
            metadata: Some(ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "Project".to_string(),
            }),
            participants: Vec::new(),
        }
    });

    assert_eq!(events.len(), 2);
    assert_eq!(events[0].key(), "bot-1");
    assert_eq!(events[1].key(), "doc-1");
    let envelope = serde_json::to_value(events[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "mention.message_sent");
    assert_eq!(envelope["metadata"]["source"]["kind"], "message");
    assert_eq!(envelope["metadata"]["source"]["id"], message_id.to_string());
    assert_eq!(envelope["metadata"]["mentioned"]["kind"], "bot");
    assert_eq!(envelope["metadata"]["mentioned"]["id"], "bot-1");
}

#[test]
fn mention_broker_events_map_entity_mention_created_and_deleted() {
    use macro_event_broker::MacroEvent as _;
    let mention = entity_mention("bot", "bot-1");

    let created = mention_broker_events_for_event(&ChannelEvent::EntityMentionCreated {
        mention: mention.clone(),
    });
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].key(), "bot-1");
    let envelope = serde_json::to_value(created[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "mention.created");
    assert_eq!(envelope["metadata"]["source"]["kind"], "document");
    assert_eq!(envelope["metadata"]["source"]["id"], "doc-1");
    assert_eq!(envelope["metadata"]["mentioned"]["kind"], "bot");
    assert_eq!(envelope["metadata"]["mentioned"]["id"], "bot-1");

    let deleted = mention_broker_events_for_event(&ChannelEvent::EntityMentionDeleted { mention });
    assert_eq!(deleted.len(), 1);
    let envelope = serde_json::to_value(deleted[0].event()).unwrap();
    assert_eq!(envelope["event_type"], "mention.deleted");
}

#[test]
fn mention_broker_events_skip_unrelated_events() {
    let events = mention_broker_events_for_event(&{
        let mut message = channel_message(Uuid::new_v4(), Uuid::new_v4());
        let mentions: Vec<SimpleMention> = vec![];
        message.mentions = mentions.clone();
        message.attachments = vec![];
        ChannelEvent::MessageCommitted {
            event: Box::new(MessageEvent {
                parent: MessageParent::Channel(Uuid::new_v4()),
                actor: String::from(Sender::new_from_user(user("alice@example.com"))),
                nonce: None,
                change: MessageChange::ReactionChanged { message },
            }),
            metadata: None,
            participants: vec![],
        }
    });
    assert!(events.is_empty());
}

#[tokio::test]
async fn handle_publishes_mention_events_alongside_channel_events() {
    let broker = TestEventBroker::default();
    let service = broker_service(broker.clone());

    service
        .handle(ChannelEvent::EntityMentionCreated {
            mention: entity_mention("bot", "bot-1"),
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].topic, "macro.mentions");
    assert_eq!(published[0].key, "bot-1");
    assert_eq!(published[0].envelope["event_type"], "mention.created");
}

fn hydrated_message(mut message: Message) -> Message {
    if let Some(bot) = message.sender_id.as_bot() {
        message.bot_profile = Some(if bot.bot_id() == bot_id::MACRO_AI_BOT_ID {
            BotSenderProfile {
                name: bot_id::MACRO_AI_NAME.into(),
                avatar_url: None,
            }
        } else {
            BotSenderProfile {
                name: "Test Bot".into(),
                avatar_url: Some("https://example.com/bot.png".into()),
            }
        });
    }
    message
}
