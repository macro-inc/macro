use super::*;
use crate::domain::{
    events::MessageChangedNotificationContext,
    models::{BotId, ParticipantRole, Sender},
    ports::{
        ChannelEventHandler, ChannelNotificationSender, ChannelRealtimePublisher,
        ChannelSearchIndexer, ChannelSideEffectContext,
    },
};
use chrono::Utc;
use std::sync::{Arc, Mutex};

type IndexedMessages = Arc<Mutex<Vec<(Uuid, Uuid)>>>;
type RemovedMessages = Arc<Mutex<Vec<(Uuid, Option<Uuid>)>>>;

#[derive(Clone)]
struct FakeContext {
    message_count: i64,
    document_mentions: Vec<ChannelDocumentMention>,
    bot_profile: Option<BotSenderProfile>,
    bot_profile_lookup_count: Arc<Mutex<usize>>,
    thread_context: ThreadNotificationContext,
}

impl Default for FakeContext {
    fn default() -> Self {
        Self {
            message_count: 2,
            document_mentions: Vec::new(),
            bot_profile: Some(BotSenderProfile {
                name: "Test Bot".to_string(),
                avatar_url: Some("https://example.com/bot.png".to_string()),
            }),
            bot_profile_lookup_count: Arc::new(Mutex::new(0)),
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

    async fn get_bot_sender_profile(&self, _bot_id: BotId) -> Option<BotSenderProfile> {
        *self.bot_profile_lookup_count.lock().unwrap() += 1;
        self.bot_profile.clone()
    }
}

#[derive(Clone, Default)]
struct FakeRealtime {
    effects: Arc<Mutex<Vec<ChannelRealtimeEffect>>>,
}

impl ChannelRealtimePublisher for FakeRealtime {
    type Err = anyhow::Error;

    async fn publish(&self, effect: ChannelRealtimeEffect) -> Result<(), Self::Err> {
        self.effects.lock().unwrap().push(effect);
        Ok(())
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
struct FakeSearch {
    indexed: IndexedMessages,
    removed: RemovedMessages,
}

impl ChannelSearchIndexer for FakeSearch {
    async fn index_message(&self, channel_id: Uuid, message_id: Uuid) {
        self.indexed.lock().unwrap().push((channel_id, message_id));
    }

    async fn remove_message(&self, channel_id: Uuid, message_id: Option<Uuid>) {
        self.removed.lock().unwrap().push((channel_id, message_id));
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
async fn macro_ai_bot_profile_is_builtin_without_context_lookup() {
    let lookup_count = Arc::new(Mutex::new(0));
    let service = ChannelSideEffectService::new(
        FakeContext {
            bot_profile: None,
            bot_profile_lookup_count: lookup_count.clone(),
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        FakeNotifications::default(),
        FakeSearch::default(),
        FakeContacts::default(),
    );
    let now = Utc::now();
    let message = MutatedMessage {
        id: Uuid::new_v4(),
        channel_id: Uuid::new_v4(),
        thread_id: None,
        sender_id: Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
        triggered_by: None,
        content: "hello".to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
    };

    let profile = service
        .bot_profile_for_message(&message)
        .await
        .expect("Macro AI should have a built-in profile");

    assert_eq!(profile.name, bot_id::MACRO_AI_NAME);
    assert_eq!(profile.avatar_url, None);
    assert_eq!(*lookup_count.lock().unwrap(), 0);
}

#[tokio::test]
async fn non_macro_bot_profile_uses_context_lookup() {
    let lookup_count = Arc::new(Mutex::new(0));
    let service = ChannelSideEffectService::new(
        FakeContext {
            bot_profile_lookup_count: lookup_count.clone(),
            ..FakeContext::default()
        },
        FakeRealtime::default(),
        FakeNotifications::default(),
        FakeSearch::default(),
        FakeContacts::default(),
    );
    let now = Utc::now();
    let message = MutatedMessage {
        id: Uuid::new_v4(),
        channel_id: Uuid::new_v4(),
        thread_id: None,
        sender_id: Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4())),
        triggered_by: None,
        content: "hello".to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
    };

    let profile = service
        .bot_profile_for_message(&message)
        .await
        .expect("non-Macro bot profile should come from context");

    assert_eq!(profile.name, "Test Bot");
    assert_eq!(*lookup_count.lock().unwrap(), 1);
}

#[tokio::test]
async fn message_posted_derives_realtime_search_and_notification_effects() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let recipient = user("recipient@example.com");
    let realtime = FakeRealtime::default();
    let notifications = FakeNotifications::default();
    let search = FakeSearch::default();
    let contacts = FakeContacts::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        realtime.clone(),
        notifications.clone(),
        search.clone(),
        contacts,
    );
    let now = Utc::now();

    service
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata: ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Project".to_string(),
            },
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
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "hello".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
            },
            mentions: Vec::new(),
            has_attachments: false,
            attachments: Vec::new(),
            nonce: Some("nonce-1".to_string()),
            notification_policy: PostMessageNotificationPolicy::Default,
        })
        .await;

    let realtime_effects = realtime.effects.lock().unwrap();
    assert_eq!(realtime_effects.len(), 1);
    let ChannelRealtimeEffect::Message {
        recipients,
        message,
        nonce,
        ..
    } = &realtime_effects[0]
    else {
        panic!("expected message realtime effect");
    };
    assert_eq!(message.id, message_id);
    assert_eq!(nonce.as_deref(), Some("nonce-1"));
    assert_eq!(recipients.len(), 2);
    drop(realtime_effects);

    assert_eq!(
        *search.indexed.lock().unwrap(),
        vec![(channel_id, message_id)]
    );

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
    ChannelEvent::MessagePosted {
        channel_id,
        metadata: ChannelMetadata {
            channel_type: ChannelType::Private,
            channel_name: "Project".to_string(),
        },
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
        message: MutatedMessage {
            id: message_id,
            channel_id,
            thread_id,
            sender_id: Sender::new_from_bot(BotId::new_from_uuid(Uuid::new_v4())),
            triggered_by: None,
            content: "hello".to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentions: Vec::new(),
        has_attachments: false,
        attachments: Vec::new(),
        nonce: None,
        notification_policy: PostMessageNotificationPolicy::Default,
    }
}

#[tokio::test]
async fn silent_message_posted_skips_notifications_only() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let recipient = user("recipient@example.com");
    let realtime = FakeRealtime::default();
    let notifications = FakeNotifications::default();
    let search = FakeSearch::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        realtime.clone(),
        notifications.clone(),
        search.clone(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata: ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Project".to_string(),
            },
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
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender),
                triggered_by: None,
                content: "transient".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
            },
            mentions: Vec::new(),
            has_attachments: false,
            attachments: Vec::new(),
            nonce: None,
            notification_policy: PostMessageNotificationPolicy::Silent,
        })
        .await;

    assert_eq!(realtime.effects.lock().unwrap().len(), 1);
    assert_eq!(
        *search.indexed.lock().unwrap(),
        vec![(channel_id, message_id)]
    );
    assert!(notifications.effects.lock().unwrap().is_empty());
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
        FakeRealtime::default(),
        notifications.clone(),
        FakeSearch::default(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle(ChannelEvent::MessageChanged {
            channel_id,
            actor: Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: Some(thread_id),
                sender_id: Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
                triggered_by: None,
                content: "final answer".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: Some(now),
                deleted_at: None,
            },
            recipients: vec![recipient.clone(), parent_sender.clone()],
            nonce: None,
            posted_notification: Some(MessageChangedNotificationContext {
                metadata: ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                },
                participants: Vec::new(),
                mentions: Vec::new(),
                has_attachments: false,
            }),
        })
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
    let realtime = FakeRealtime::default();
    let notifications = FakeNotifications::default();
    let search = FakeSearch::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        realtime.clone(),
        notifications.clone(),
        search.clone(),
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

    assert_eq!(realtime.effects.lock().unwrap().len(), 1);
    assert_eq!(
        *search.indexed.lock().unwrap(),
        vec![(channel_id, message_id)]
    );

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
    let realtime = FakeRealtime::default();
    let notifications = FakeNotifications::default();
    let search = FakeSearch::default();
    let service = ChannelSideEffectService::new(
        FakeContext {
            bot_profile: None,
            ..FakeContext::default()
        },
        realtime.clone(),
        notifications.clone(),
        search.clone(),
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

    assert_eq!(realtime.effects.lock().unwrap().len(), 1);
    assert_eq!(
        *search.indexed.lock().unwrap(),
        vec![(channel_id, message_id)]
    );
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
        FakeRealtime::default(),
        notifications.clone(),
        FakeSearch::default(),
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
        FakeRealtime::default(),
        notifications.clone(),
        FakeSearch::default(),
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
        FakeRealtime::default(),
        notifications.clone(),
        FakeSearch::default(),
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
async fn user_message_with_bot_mention_enqueues_bot_trigger() {
    let channel_id = Uuid::new_v4();
    let message_id = Uuid::new_v4();
    let sender = user("sender@example.com");
    let recipient = user("recipient@example.com");
    let (bot_trigger_sender, mut bot_trigger_receiver) = tokio::sync::mpsc::unbounded_channel();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        FakeNotifications::default(),
        FakeSearch::default(),
        FakeContacts::default(),
    )
    .with_bot_trigger_sender(bot_trigger_sender);
    let now = Utc::now();

    service
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata: ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Project".to_string(),
            },
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
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender),
                triggered_by: None,
                content: "@macro help".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
            },
            mentions: vec![SimpleMention {
                entity_type: "user".to_string(),
                entity_id: bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string(),
            }],
            has_attachments: false,
            attachments: Vec::new(),
            nonce: None,
            notification_policy: PostMessageNotificationPolicy::Default,
        })
        .await;

    let trigger = bot_trigger_receiver
        .try_recv()
        .expect("expected bot trigger");
    assert_eq!(trigger.channel_id, channel_id);
    assert_eq!(trigger.message.id, message_id);
    assert_eq!(trigger.bot_ids, vec![bot_id::MACRO_AI_BOT_ID]);
    assert!(bot_trigger_receiver.try_recv().is_err());
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
        FakeRealtime::default(),
        notifications.clone(),
        FakeSearch::default(),
        FakeContacts::default(),
    );
    let now = Utc::now();

    service
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata: ChannelMetadata {
                channel_type: ChannelType::Private,
                channel_name: "Project".to_string(),
            },
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
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::new_from_user(sender.clone()),
                triggered_by: None,
                content: "hello".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
            },
            mentions: vec![
                SimpleMention {
                    entity_type: "user".to_string(),
                    entity_id: mentioned.as_ref().to_string(),
                },
                SimpleMention {
                    entity_type: "document".to_string(),
                    entity_id: "doc-1".to_string(),
                },
            ],
            has_attachments: false,
            attachments: Vec::new(),
            nonce: None,
            notification_policy: PostMessageNotificationPolicy::Default,
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
fn contact_sync_ignores_public_channel_created() {
    let event = ChannelEvent::ChannelCreated {
        channel_id: Uuid::nil(),
        actor: Sender::new_from_user(user("alice@example.com")),
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
        use macro_event_topics::Topic as _;
        self.published.lock().unwrap().push(PublishedEvent {
            topic: event.topic().as_str().to_string(),
            key: event.key().to_string(),
            envelope: serde_json::to_value(event.event())?,
        });
        Ok(tokio::spawn(async { Ok(()) }))
    }
}

#[derive(Clone, Default)]
struct FailingEventBroker;

impl MacroEventBroker for FailingEventBroker {
    fn send_event<E: macro_event_broker::MacroEvent + ?Sized>(
        &self,
        _event: &E,
    ) -> Result<
        tokio::task::JoinHandle<Result<(), macro_event_broker::EventBrokerError>>,
        macro_event_broker::EventBrokerError,
    > {
        Err(macro_event_broker::EventBrokerError::Publish(
            "broker unavailable".to_string(),
        ))
    }
}

fn broker_service(
    broker: TestEventBroker,
) -> ChannelSideEffectService<
    FakeContext,
    FakeRealtime,
    FakeNotifications,
    FakeSearch,
    FakeContacts,
    TestEventBroker,
> {
    ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        FakeNotifications::default(),
        FakeSearch::default(),
        FakeContacts::default(),
    )
    .with_macro_event_broker(broker)
}

fn attachment(channel_id: Uuid, message_id: Uuid) -> MutatedAttachment {
    MutatedAttachment {
        id: Uuid::new_v4(),
        channel_id,
        message_id,
        entity_type: "document".to_string(),
        entity_id: "doc-1".to_string(),
        width: None,
        height: None,
        created_at: Utc::now(),
    }
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
        .handle(ChannelEvent::MessagePosted {
            channel_id,
            metadata: ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "Project".to_string(),
            },
            participants: Vec::new(),
            message: MutatedMessage {
                id: message_id,
                channel_id,
                thread_id: None,
                sender_id: Sender::new_from_user(user("alice@example.com")),
                triggered_by: None,
                content: "hello world".to_string(),
                created_at: now,
                updated_at: now,
                edited_at: None,
                deleted_at: None,
            },
            mentions: Vec::new(),
            has_attachments: true,
            attachments: vec![attachment(channel_id, message_id)],
            nonce: None,
            notification_policy: PostMessageNotificationPolicy::Default,
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
        .handle(ChannelEvent::AttachmentsChanged {
            channel_id,
            actor: Sender::new_from_user(user("alice@example.com")),
            message_id,
            attachments: vec![added.clone()],
            added: vec![added.clone()],
            removed: vec![removed.clone()],
            recipients: Vec::new(),
            nonce: None,
        })
        .await;

    let published = broker.published.lock().unwrap();
    assert_eq!(published.len(), 2);
    assert_eq!(
        published[0].envelope["event_type"],
        "channel.message_attachment_created"
    );
    assert_eq!(
        published[0].envelope["metadata"]["attachments"][0]["attachment_id"],
        added.id.to_string()
    );
    assert_eq!(
        published[1].envelope["event_type"],
        "channel.message_attachment_removed"
    );
    assert_eq!(
        published[1].envelope["metadata"]["attachments"][0]["attachment_id"],
        removed.id.to_string()
    );
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
        .handle(ChannelEvent::TypingChanged {
            channel_id: Uuid::new_v4(),
            actor: Sender::new_from_user(user("alice@example.com")),
            action: TypingAction::Start,
            thread_id: None,
            recipients: Vec::new(),
            nonce: None,
        })
        .await;

    assert!(broker.published.lock().unwrap().is_empty());
}

#[tokio::test]
async fn publish_failure_does_not_break_other_side_effects() {
    let search = FakeSearch::default();
    let service = ChannelSideEffectService::new(
        FakeContext::default(),
        FakeRealtime::default(),
        FakeNotifications::default(),
        search.clone(),
        FakeContacts::default(),
    )
    .with_macro_event_broker(FailingEventBroker);
    let channel_id = Uuid::new_v4();

    service
        .handle(ChannelEvent::ChannelDeleted {
            channel_id,
            actor: Sender::new_from_user(user("alice@example.com")),
        })
        .await;

    assert_eq!(
        search.removed.lock().unwrap().as_slice(),
        &[(channel_id, None)]
    );
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

#[test]
fn broker_events_skip_reaction_changes() {
    let events = broker_events_for_event(&ChannelEvent::ReactionChanged {
        channel_id: Uuid::new_v4(),
        actor: Sender::new_from_user(user("alice@example.com")),
        message_id: Uuid::new_v4(),
        reactions: Vec::new(),
        recipients: Vec::new(),
        nonce: None,
    });

    assert!(events.is_empty());
}
