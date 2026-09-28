use super::*;
use agent_trigger::domain::broker_events::{
    AgentBotMentionedEvent, AgentMentionedEvent, ChannelEventMetadata, ExistingAgentSessionEvent,
    NewAgentSessionEvent, ThreadEventMetadata, ThreadMessageKind,
};
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::models::ChannelType;
use chrono::Utc;
use messages::domain::events::MessagePostedMetadata;
use messages::domain::models::MessageParent;
use std::sync::Mutex;

fn test_session() -> AgentSessionId {
    AgentSessionId::new_from_uuid(Uuid::from_u128(0xA))
}

fn sender() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@example.com").unwrap()
}

/// A channel post in the channel-only shape channel triggers travel in.
fn message(content: &str, thread_id: Option<Uuid>) -> ChannelMessagePostedMetadata {
    ChannelMessagePostedMetadata {
        channel_id: Uuid::from_u128(1),
        message_id: Uuid::from_u128(2),
        thread_id,
        sender: ChannelSender::new_from_user(sender()),
        triggered_by: None,
        channel_type: ChannelType::Public,
        content: content.to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn document() -> MessageParent {
    MessageParent::parse("document", "doc-1").unwrap()
}

fn document_message(content: &str, thread_id: Option<Uuid>) -> MessagePostedMetadata {
    MessagePostedMetadata {
        parent: document(),
        message_id: Uuid::from_u128(2),
        thread_id,
        root_id: thread_id.unwrap_or(Uuid::from_u128(2)),
        sender: ChannelSender::new_from_user(sender()),
        triggered_by: None,
        content: content.to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: Utc::now(),
    }
}

fn mention(content: &str) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: bot_id::BotId::TEST_A,
            message: message(content, None),
        },
    ))
}

fn follow_up(content: &str) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(ChannelEventMetadata {
        bot_id: bot_id::BotId::TEST_A,
        session_id: test_session(),
        kind: ThreadMessageKind::MentionThread,
        message: message(content, Some(Uuid::from_u128(7))),
    }))
}

/// Document triggers arrive in the parent-aware shape and become the same
/// work as channel ones, addressed to the document.
#[test]
fn document_triggers_become_work_on_the_document() {
    let opened =
        AgentTriggerTopicEvent::New(NewAgentSessionEvent::Mentioned(AgentMentionedEvent {
            bot_id: bot_id::BotId::TEST_A,
            message: document_message("summarize this", None),
        }));
    assert_eq!(
        trigger_to_work(opened).expect("a document mention is work"),
        TriggerWork::OpenAndPrompt {
            bot: bot_id::BotId::TEST_A,
            sender: sender(),
            parent: document(),
            thread_id: Uuid::from_u128(2),
            message_id: Uuid::from_u128(2),
            content: "summarize this".to_owned(),
        }
    );
    let followed =
        AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Thread(ThreadEventMetadata {
            bot_id: bot_id::BotId::TEST_A,
            session_id: test_session(),
            kind: ThreadMessageKind::Inferred,
            message: document_message("and this", Some(Uuid::from_u128(7))),
        }));
    assert_eq!(
        trigger_to_work(followed).expect("a document follow-up is work"),
        TriggerWork::PromptExisting {
            session: test_session(),
            sender: sender(),
            content: "and this".to_owned(),
        }
    );
}

#[test]
fn a_mention_becomes_open_and_prompt_rooting_its_own_thread() {
    let work = trigger_to_work(mention("fix the test")).expect("a mention is work");
    assert_eq!(
        work,
        TriggerWork::OpenAndPrompt {
            bot: bot_id::BotId::TEST_A,
            sender: sender(),
            parent: messages::domain::models::MessageParent::Channel(Uuid::from_u128(1)),
            thread_id: Uuid::from_u128(2),
            message_id: Uuid::from_u128(2),
            content: "fix the test".to_owned(),
        }
    );
}

#[test]
fn a_follow_up_becomes_prompt_existing() {
    let work = trigger_to_work(follow_up("keep going")).expect("a follow-up is work");
    assert_eq!(
        work,
        TriggerWork::PromptExisting {
            session: test_session(),
            sender: sender(),
            content: "keep going".to_owned(),
        }
    );
}

#[test]
fn a_bots_own_message_is_skipped() {
    let mut event = mention("self talk");
    if let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
        &mut event
    {
        mentioned.message.sender = ChannelSender::new_from_bot(bot_id::BotId::TEST_B);
    }
    assert_eq!(trigger_to_work(event), Err(Skipped::NotFromUser));
}

#[test]
fn trigger_filters_name_this_bot_and_every_trigger_event() {
    let filters = trigger_filters([bot_id::BotId::TEST_A]);
    assert_eq!(filters.len(), 1);
    let filter = &filters[0];
    assert_eq!(
        filter.events,
        vec![
            "agent_trigger.new".to_owned(),
            "agent_trigger.existing".to_owned()
        ]
    );
    assert_eq!(
        filter.ids.as_deref(),
        Some([bot_id::BotId::TEST_A.to_string()].as_slice())
    );
}

/// Records executed work instead of doing anything.
#[derive(Default)]
struct RecordingExecutor {
    executed: Mutex<Vec<TriggerWork>>,
    fail: bool,
}

impl WorkExecutor for std::sync::Arc<RecordingExecutor> {
    async fn execute(&self, work: TriggerWork) -> Result<(), crate::dispatch::DispatchError> {
        self.executed.lock().unwrap().push(work);
        if self.fail {
            return Err(crate::dispatch::DispatchError::Api(
                crate::outbound::agent_session::ApiError::Refused {
                    status: reqwest::StatusCode::INTERNAL_SERVER_ERROR,
                    message: "boom".to_owned(),
                },
            ));
        }
        Ok(())
    }
}

#[tokio::test]
async fn a_mention_event_executes() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());

    handle_event(Event::new(mention("fix it")), &executor)
        .await
        .expect("a mention is work");

    assert_eq!(executor.executed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_skipped_event_is_not_an_error() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());
    let mut event = mention("self talk");
    if let AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(mentioned)) =
        &mut event
    {
        mentioned.message.sender = ChannelSender::new_from_bot(bot_id::BotId::TEST_B);
    }

    handle_event(Event::new(event), &executor)
        .await
        .expect("skipped events are not errors");

    assert!(executor.executed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_work_is_returned() {
    let executor = std::sync::Arc::new(RecordingExecutor {
        fail: true,
        ..Default::default()
    });

    assert!(
        handle_event(Event::new(mention("fix it")), &executor)
            .await
            .is_err()
    );
}
