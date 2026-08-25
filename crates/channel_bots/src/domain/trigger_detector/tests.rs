use std::sync::{Arc, Mutex};

use async_trait::async_trait;
use channels::domain::models::{
    AttachmentEntityReference, ChannelAttachmentType, ChannelContextMessage, ChannelMessageFilters,
    ChannelParticipant, MessagePageDirection, MutatedMessage, ResolvedChannelMessage, Sender,
    ThreadReply,
};
use channels::domain::ports::{
    ChannelAttachmentsPage, ChannelMessagesErr, ChannelMessagesQueryResult, ChannelService,
};
use chrono::Utc;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{CreatedAt, Query};

use super::*;

struct TestChannelService {
    parent: Option<ChannelContextMessage>,
    thread_replies: Vec<ThreadReply>,
}

impl ChannelService for TestChannelService {
    fn get_channel_messages(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _direction: MessagePageDirection,
        _limit: u16,
        _filters: &ChannelMessageFilters,
        _notification_user_id: Option<MacroUserIdStr<'static>>,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for detector tests") }
    }

    fn get_channel_attachments(
        &self,
        _channel_id: Uuid,
        _query: Query<Uuid, CreatedAt, ()>,
        _limit: u16,
        _attachment_type: Option<ChannelAttachmentType>,
    ) -> impl Future<Output = Result<ChannelAttachmentsPage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for detector tests") }
    }

    fn get_channel_participants(
        &self,
        _channel_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ChannelParticipant>, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for detector tests") }
    }

    fn get_message_context(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _before: i64,
        _after: i64,
    ) -> impl Future<Output = Result<Vec<ChannelContextMessage>, ChannelMessagesErr>> + Send {
        let messages = self.parent.clone().into_iter().collect::<Vec<_>>();
        async move { Ok(messages) }
    }

    fn get_attachment_references(
        &self,
        _entity_type: String,
        _entity_id: String,
        _user_id: String,
    ) -> impl Future<Output = Result<Vec<AttachmentEntityReference>, ChannelMessagesErr>> + Send
    {
        async move { unimplemented!("not needed for detector tests") }
    }

    fn get_channel_messages_around(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
        _limit: u16,
    ) -> impl Future<Output = Result<ChannelMessagesQueryResult, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for detector tests") }
    }

    fn get_thread_replies(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ThreadReply>, ChannelMessagesErr>> + Send {
        let replies = self.thread_replies.clone();
        async move { Ok(replies) }
    }

    fn resolve_message(
        &self,
        _channel_id: Uuid,
        _message_id: Uuid,
    ) -> impl Future<Output = Result<ResolvedChannelMessage, ChannelMessagesErr>> + Send {
        async move { unimplemented!("not needed for detector tests") }
    }
}

struct TestClassifier {
    result: anyhow::Result<bool>,
    received: Mutex<Option<Vec<TranscriptMessage>>>,
}

impl TestClassifier {
    fn returning(result: anyhow::Result<bool>) -> Self {
        Self {
            result,
            received: Mutex::new(None),
        }
    }

    fn received_thread(&self) -> Option<Vec<TranscriptMessage>> {
        self.received.lock().unwrap().clone()
    }
}

#[async_trait]
impl InferredTriggerClassifier for TestClassifier {
    async fn expects_response(
        &self,
        _requesting_user: &MacroUserIdStr<'static>,
        thread: &[TranscriptMessage],
    ) -> anyhow::Result<bool> {
        *self.received.lock().unwrap() = Some(thread.to_vec());
        match &self.result {
            Ok(value) => Ok(*value),
            Err(err) => anyhow::bail!("{err}"),
        }
    }
}

fn user_id(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{email}")).unwrap()
}

fn macro_ai_sender_id() -> String {
    bot_id::MACRO_AI_BOT_ID.into_storage_id().to_string()
}

fn candidate(
    channel_id: Uuid,
    thread_id: Option<Uuid>,
    sender: Sender,
    content: &str,
    mentioned_bot_ids: Vec<bot_id::BotId>,
) -> ChannelBotTrigger {
    let now = Utc::now();
    ChannelBotTrigger {
        channel_id,
        message: MutatedMessage {
            id: Uuid::new_v4(),
            channel_id,
            thread_id,
            sender_id: sender,
            triggered_by: None,
            content: content.to_string(),
            created_at: now,
            updated_at: now,
            edited_at: None,
            deleted_at: None,
        },
        mentioned_bot_ids,
        span: tracing::Span::none(),
    }
}

fn parent_message(
    channel_id: Uuid,
    id: Uuid,
    sender_id: &str,
    content: &str,
) -> ChannelContextMessage {
    let now = Utc::now();
    ChannelContextMessage {
        id,
        channel_id,
        thread_id: None,
        sender_id: sender_id.to_string(),
        triggered_by: None,
        bot_profile: None,
        content: content.to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        deleted_at: None,
    }
}

fn thread_reply(sender_id: &str, content: &str) -> ThreadReply {
    let now = Utc::now();
    ThreadReply {
        id: Uuid::new_v4(),
        sender_id: sender_id.to_string(),
        triggered_by: None,
        bot_profile: None,
        content: content.to_string(),
        created_at: now,
        updated_at: now,
        edited_at: None,
        reactions: Vec::new(),
        attachments: Vec::new(),
    }
}

fn detector(
    channels: TestChannelService,
    classifier: Arc<TestClassifier>,
) -> MentionOrInferredDetector<TestChannelService, TestClassifier> {
    MentionOrInferredDetector::new(Arc::new(channels), classifier)
}

fn thread_with_agent_reply(channel_id: Uuid, parent_id: Uuid) -> TestChannelService {
    TestChannelService {
        parent: Some(parent_message(
            channel_id,
            parent_id,
            "macro|alice@example.com",
            "notifications are broken",
        )),
        thread_replies: vec![thread_reply(
            &macro_ai_sender_id(),
            "what is broken exactly?",
        )],
    }
}

#[tokio::test]
async fn mention_triggers_each_mentioned_bot_without_classification() {
    let channel_id = Uuid::new_v4();
    let other_bot = bot_id::BotId::new_from_uuid(Uuid::new_v4());
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        TestChannelService {
            parent: None,
            thread_replies: Vec::new(),
        },
        classifier.clone(),
    );

    let invocations = detector
        .detect(&candidate(
            channel_id,
            None,
            Sender::new_from_user(user_id("alice@example.com")),
            "@macro help",
            vec![bot_id::MACRO_AI_BOT_ID, other_bot],
        ))
        .await;

    assert_eq!(
        invocations,
        vec![
            BotInvocation {
                bot_id: bot_id::MACRO_AI_BOT_ID,
                trigger: BotTrigger::Mention,
            },
            BotInvocation {
                bot_id: other_bot,
                trigger: BotTrigger::Mention,
            },
        ]
    );
    assert!(classifier.received_thread().is_none());
}

#[tokio::test]
async fn bot_authored_message_never_triggers() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        thread_with_agent_reply(channel_id, parent_id),
        classifier.clone(),
    );

    let invocations = detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_bot(bot_id::MACRO_AI_BOT_ID),
            "I fixed it",
            Vec::new(),
        ))
        .await;

    assert!(invocations.is_empty());
    assert!(classifier.received_thread().is_none());
}

#[tokio::test]
async fn top_level_message_is_never_inferred() {
    let channel_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        TestChannelService {
            parent: None,
            thread_replies: Vec::new(),
        },
        classifier.clone(),
    );

    let invocations = detector
        .detect(&candidate(
            channel_id,
            None,
            Sender::new_from_user(user_id("alice@example.com")),
            "macro agent respond",
            Vec::new(),
        ))
        .await;

    assert!(invocations.is_empty());
    assert!(classifier.received_thread().is_none());
}

#[tokio::test]
async fn thread_without_agent_message_is_never_inferred() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        TestChannelService {
            parent: Some(parent_message(
                channel_id,
                parent_id,
                "macro|alice@example.com",
                "anyone looked at this?",
            )),
            thread_replies: vec![thread_reply("macro|bob@example.com", "not yet")],
        },
        classifier.clone(),
    );

    let invocations = detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_user(user_id("carol@example.com")),
            "can someone respond",
            Vec::new(),
        ))
        .await;

    assert!(invocations.is_empty());
    assert!(classifier.received_thread().is_none());
}

#[tokio::test]
async fn thread_reply_after_agent_message_infers_when_classifier_agrees() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        thread_with_agent_reply(channel_id, parent_id),
        classifier.clone(),
    );

    let invocations = detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_user(user_id("alice@example.com")),
            "it fires twice per message",
            Vec::new(),
        ))
        .await;

    assert_eq!(
        invocations,
        vec![BotInvocation {
            bot_id: bot_id::MACRO_AI_BOT_ID,
            trigger: BotTrigger::Inferred,
        }]
    );

    let thread = classifier.received_thread().expect("classifier called");
    assert_eq!(
        thread,
        vec![
            TranscriptMessage {
                from_agent: false,
                sender: "alice".to_string(),
                content: "notifications are broken".to_string(),
            },
            TranscriptMessage {
                from_agent: true,
                sender: bot_id::MACRO_AI_NAME.to_string(),
                content: "what is broken exactly?".to_string(),
            },
            TranscriptMessage {
                from_agent: false,
                sender: "alice".to_string(),
                content: "it fires twice per message".to_string(),
            },
        ]
    );
}

#[tokio::test]
async fn classifier_rejection_yields_no_trigger() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(false)));
    let detector = detector(thread_with_agent_reply(channel_id, parent_id), classifier);

    let invocations = detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_user(user_id("alice@example.com")),
            "thanks, I'll take it from here",
            Vec::new(),
        ))
        .await;

    assert!(invocations.is_empty());
}

#[tokio::test]
async fn classifier_failure_yields_no_trigger() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Err(anyhow::anyhow!(
        "model down"
    ))));
    let detector = detector(thread_with_agent_reply(channel_id, parent_id), classifier);

    let invocations = detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_user(user_id("alice@example.com")),
            "it fires twice per message",
            Vec::new(),
        ))
        .await;

    assert!(invocations.is_empty());
}

#[tokio::test]
async fn candidate_message_is_appended_when_missing_from_replies() {
    let channel_id = Uuid::new_v4();
    let parent_id = Uuid::new_v4();
    let classifier = Arc::new(TestClassifier::returning(Ok(true)));
    let detector = detector(
        thread_with_agent_reply(channel_id, parent_id),
        classifier.clone(),
    );

    detector
        .detect(&candidate(
            channel_id,
            Some(parent_id),
            Sender::new_from_user(user_id("bob@example.com")),
            "u so dumb",
            Vec::new(),
        ))
        .await;

    let thread = classifier.received_thread().expect("classifier called");
    let last = thread.last().expect("non-empty transcript");
    assert_eq!(last.sender, "bob");
    assert_eq!(last.content, "u so dumb");
    assert!(!last.from_agent);
}
