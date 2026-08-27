use super::*;
use agent_trigger::domain::broker_events::AgentBotMentionedEvent;
use channel_sender::ChannelSender;
use channels::domain::broker_events::ChannelMessagePostedMetadata;
use channels::domain::models::ChannelType;
use chrono::Utc;
use std::sync::Mutex;

const SECRET: &str = "signing-secret";

fn test_session() -> AgentSessionId {
    AgentSessionId::new_from_uuid(Uuid::from_u128(0xA))
}

fn sender() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("asker@example.com").unwrap()
}

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

fn mention(content: &str) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::New(NewAgentSessionEvent::TopLevelMentioned(
        AgentBotMentionedEvent {
            bot_id: bot_id::BotId::TEST_A,
            message: message(content, None),
        },
    ))
}

fn follow_up(content: &str) -> AgentTriggerTopicEvent {
    AgentTriggerTopicEvent::Existing(ExistingAgentSessionEvent::Channel(
        agent_trigger::domain::broker_events::ChannelEventMetadata {
            bot_id: bot_id::BotId::TEST_A,
            session_id: test_session(),
            kind: agent_trigger::domain::broker_events::ChannelKind::MentionThread,
            message: message(content, Some(Uuid::from_u128(7))),
        },
    ))
}

#[test]
fn a_mention_becomes_open_and_prompt_rooting_its_own_thread() {
    let work = trigger_to_work(mention("fix the test")).expect("a mention is work");
    assert_eq!(
        work,
        TriggerWork::OpenAndPrompt {
            sender: sender(),
            channel_id: Uuid::from_u128(1),
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

fn delivery(event: &AgentTriggerTopicEvent, secret: &str) -> (HeaderMap, Bytes) {
    let body = serde_json::to_vec(&Event::new(event.clone())).unwrap();
    let timestamp = "1755188000";
    let signature = webhook_signature::sign(secret, timestamp, &body).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(TIMESTAMP_HEADER, timestamp.parse().unwrap());
    headers.insert(SIGNATURE_HEADER, signature.parse().unwrap());
    (headers, Bytes::from(body))
}

fn state(
    executor: std::sync::Arc<RecordingExecutor>,
) -> Arc<WebhookState<std::sync::Arc<RecordingExecutor>>> {
    Arc::new(WebhookState {
        executor,
        signing_secret: SECRET.to_owned(),
    })
}

#[tokio::test]
async fn a_signed_mention_executes() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());
    let (headers, body) = delivery(&mention("fix it"), SECRET);

    let status = ingest(State(state(executor.clone())), headers, body).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(executor.executed.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn a_bad_signature_is_rejected_before_anything_runs() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());
    let (headers, body) = delivery(&mention("fix it"), "wrong-secret");

    let status = ingest(State(state(executor.clone())), headers, body).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(executor.executed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn missing_signature_headers_are_rejected() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());
    let (_, body) = delivery(&mention("fix it"), SECRET);

    let status = ingest(State(state(executor.clone())), HeaderMap::new(), body).await;

    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert!(executor.executed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_undecodable_payload_is_acked_and_dropped() {
    let executor = std::sync::Arc::new(RecordingExecutor::default());
    let body = Bytes::from_static(b"not json");
    let timestamp = "1755188000";
    let signature = webhook_signature::sign(SECRET, timestamp, &body).unwrap();
    let mut headers = HeaderMap::new();
    headers.insert(TIMESTAMP_HEADER, timestamp.parse().unwrap());
    headers.insert(SIGNATURE_HEADER, signature.parse().unwrap());

    let status = ingest(State(state(executor.clone())), headers, body).await;

    assert_eq!(status, StatusCode::OK);
    assert!(executor.executed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_work_asks_for_redelivery() {
    let executor = std::sync::Arc::new(RecordingExecutor {
        fail: true,
        ..Default::default()
    });
    let (headers, body) = delivery(&mention("fix it"), SECRET);

    let status = ingest(State(state(executor.clone())), headers, body).await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}
