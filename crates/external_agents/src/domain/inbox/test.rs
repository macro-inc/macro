use super::*;
use crate::domain::fakes::{FakeEndpoints, FakeRepo};
use agent_session::domain::model::AgentSessionId;
use agent_trigger::domain::broker_events::{
    AgentBotMentionedEvent, AgentConversationMessageEvent, AgentMentionedEvent,
};
use channel_sender::ChannelSender;
use channels::domain::{broker_events::ChannelMessagePostedMetadata, models::ChannelType};
use messages::domain::models::MessageParent;
use uuid::Uuid;

const AGENT: BotId = BotId::new_from_uuid(Uuid::from_u128(0xA6E));
const DM: Uuid = Uuid::from_u128(0xD1);
const CHANNEL: Uuid = Uuid::from_u128(0xC4);

fn sender() -> ChannelSender<'static> {
    ChannelSender::try_from("macro|owner@example.com".to_owned()).unwrap()
}

fn posted(parent: MessageParent, message: u128, thread: Option<u128>) -> MessagePostedMetadata {
    let message_id = Uuid::from_u128(message);
    let thread_id = thread.map(Uuid::from_u128);
    MessagePostedMetadata {
        parent,
        message_id,
        thread_id,
        root_id: thread_id.unwrap_or(message_id),
        sender: sender(),
        triggered_by: None,
        content: "what changed today?".to_owned(),
        mentions: vec![],
        attachments: vec![],
        created_at: chrono::DateTime::UNIX_EPOCH,
    }
}

fn direct_turn(bot_id: BotId) -> Event<AgentTriggerTopicEvent> {
    Event::new(AgentTriggerTopicEvent::New(
        NewAgentSessionEvent::ConversationMessage(AgentConversationMessageEvent {
            bot_id,
            session_id: AgentSessionId::new(),
            message: posted(MessageParent::Channel(DM), 1, None),
            context: None,
        }),
    ))
}

fn channel_mention(thread: Option<u128>) -> Event<AgentTriggerTopicEvent> {
    let message_id = Uuid::from_u128(2);
    Event::new(AgentTriggerTopicEvent::New(
        NewAgentSessionEvent::TopLevelMentioned(AgentBotMentionedEvent {
            bot_id: AGENT,
            message: ChannelMessagePostedMetadata {
                channel_id: CHANNEL,
                message_id,
                thread_id: thread.map(Uuid::from_u128),
                sender: sender(),
                triggered_by: None,
                channel_type: ChannelType::Public,
                content: "@outside summarize this thread".to_owned(),
                mentions: vec![],
                attachments: vec![],
                created_at: chrono::DateTime::UNIX_EPOCH,
            },
            context: None,
        }),
    ))
}

fn inbox(
    webhook_id: Option<&str>,
) -> ExternalAgentInboxService<FakeRepo, FakeEndpoints> {
    let repo = FakeRepo::default();
    repo.agents
        .lock()
        .unwrap()
        .insert(AGENT, webhook_id.map(str::to_owned));
    ExternalAgentInboxService::new(repo, FakeEndpoints::default())
}

fn recorded(inbox: &ExternalAgentInboxService<FakeRepo, FakeEndpoints>) -> Vec<ExternalAgentEvent> {
    inbox
        .repo
        .events
        .lock()
        .unwrap()
        .iter()
        .map(|(_, event)| event.clone())
        .collect()
}

#[tokio::test]
async fn a_direct_message_is_recorded_for_its_timeline_and_pushed() {
    let inbox = inbox(Some("wh_agent"));

    inbox.record_trigger(&direct_turn(AGENT)).await.unwrap();

    let events = recorded(&inbox);
    assert_eq!(events.len(), 1);
    let event = &events[0];
    assert_eq!(event.kind, ExternalAgentEventKind::DirectMessage);
    assert_eq!(event.parent, MessageParent::Channel(DM));
    assert_eq!(event.message_id, Uuid::from_u128(1));
    assert_eq!(event.reply_thread_id, None, "answered on the DM timeline");
    assert_eq!(event.invoking_user.as_ref(), "macro|owner@example.com");
    assert_eq!(event.content, "what changed today?");
    assert_eq!(
        *inbox.endpoints.pushed.lock().unwrap(),
        vec![("wh_agent".to_owned(), event.id)],
    );
}

#[tokio::test]
async fn a_mention_is_answered_in_the_thread_it_was_made_in() {
    let inbox = inbox(None);

    inbox.record_trigger(&channel_mention(None)).await.unwrap();
    inbox
        .record_trigger(&channel_mention(Some(0x700)))
        .await
        .unwrap();

    let events = recorded(&inbox);
    assert_eq!(
        events
            .iter()
            .map(|event| (event.kind, event.parent.clone(), event.reply_thread_id))
            .collect::<Vec<_>>(),
        vec![
            (
                ExternalAgentEventKind::Mention,
                MessageParent::Channel(CHANNEL),
                Some(Uuid::from_u128(2)),
            ),
            (
                ExternalAgentEventKind::Mention,
                MessageParent::Channel(CHANNEL),
                Some(Uuid::from_u128(0x700)),
            ),
        ],
    );
    assert!(
        inbox.endpoints.pushed.lock().unwrap().is_empty(),
        "a polling agent is pushed nothing"
    );
}

#[tokio::test]
async fn a_document_mention_keeps_its_parent() {
    let inbox = inbox(None);
    let parent = MessageParent::parse("document", "doc-1").unwrap();

    inbox
        .record_trigger(&Event::new(AgentTriggerTopicEvent::New(
            NewAgentSessionEvent::Mentioned(AgentMentionedEvent {
                bot_id: AGENT,
                message: posted(parent.clone(), 3, None),
                context: None,
            }),
        )))
        .await
        .unwrap();

    let events = recorded(&inbox);
    assert_eq!(events[0].parent, parent);
    assert_eq!(events[0].reply_thread_id, Some(Uuid::from_u128(3)));
}

#[tokio::test]
async fn a_redelivered_trigger_records_one_event_and_pushes_that_event_again() {
    let inbox = inbox(Some("wh_agent"));
    let trigger = direct_turn(AGENT);

    inbox.record_trigger(&trigger).await.unwrap();
    inbox.record_trigger(&trigger).await.unwrap();

    let events = recorded(&inbox);
    assert_eq!(events.len(), 1);
    assert_eq!(
        *inbox.endpoints.pushed.lock().unwrap(),
        vec![
            ("wh_agent".to_owned(), events[0].id),
            ("wh_agent".to_owned(), events[0].id),
        ],
    );
}

#[tokio::test]
async fn triggers_for_agents_that_are_not_external_are_ignored() {
    let inbox = inbox(Some("wh_agent"));
    let other = BotId::new_from_uuid(Uuid::from_u128(0xB07));

    inbox.record_trigger(&direct_turn(other)).await.unwrap();

    assert!(recorded(&inbox).is_empty());
    assert!(inbox.endpoints.pushed.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unattributed_bot_post_addresses_nobody() {
    let inbox = inbox(Some("wh_agent"));
    let mut trigger = direct_turn(AGENT);
    let AgentTriggerTopicEvent::New(NewAgentSessionEvent::ConversationMessage(turn)) =
        &mut trigger.event
    else {
        unreachable!("a direct turn");
    };
    turn.message.sender = ChannelSender::try_from(
        bot_id::BotId::new_from_uuid(Uuid::from_u128(0xB07))
            .into_storage_id()
            .to_string(),
    )
    .unwrap();

    inbox.record_trigger(&trigger).await.unwrap();

    assert!(recorded(&inbox).is_empty());
}
