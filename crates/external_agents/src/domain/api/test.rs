use super::*;
use crate::domain::fakes::{FakeAccess, FakeRepo, OWNER, user};
use crate::domain::models::ExternalAgentEventKind;
use channel_sender::ChannelSender;
use messages::domain::{
    api::MockMessageCommands,
    models::{Message, MessageParent},
};
use std::sync::Mutex;

const AGENT: BotId = BotId::new_from_uuid(Uuid::from_u128(0xA6E));
const DM: Uuid = Uuid::from_u128(0xD1);
const CHANNEL: Uuid = Uuid::from_u128(0xC4);

fn event(id: u128, kind: ExternalAgentEventKind) -> ExternalAgentEvent {
    let (parent, reply_thread_id) = match kind {
        ExternalAgentEventKind::DirectMessage => (MessageParent::Channel(DM), None),
        ExternalAgentEventKind::Mention => {
            (MessageParent::Channel(CHANNEL), Some(Uuid::from_u128(0x700)))
        }
    };
    ExternalAgentEvent {
        id: Uuid::from_u128(id),
        bot_id: AGENT,
        kind,
        parent,
        message_id: Uuid::from_u128(0x100 + id),
        message_thread_id: None,
        reply_thread_id,
        sender_id: OWNER.to_owned(),
        invoking_user: user(OWNER),
        content: "what changed today?".to_owned(),
        message_created_at: chrono::DateTime::UNIX_EPOCH,
    }
}

fn repo_with(events: Vec<ExternalAgentEvent>) -> FakeRepo {
    let repo = FakeRepo::default();
    repo.agents.lock().unwrap().insert(AGENT, None);
    *repo.events.lock().unwrap() = events
        .into_iter()
        .map(|event| (Uuid::now_v7(), event))
        .collect();
    repo
}

fn posted_message(parent: MessageParent, thread_id: Option<Uuid>, id: Uuid) -> Message {
    Message {
        id,
        parent,
        thread_id,
        sender_id: ChannelSender::try_from(AGENT.into_storage_id().to_string()).unwrap(),
        guest_name: None,
        imported_author: None,
        bot_profile: None,
        mentions: vec![],
        triggered_by: Some(OWNER.to_owned()),
        triggered_via: None,
        content: "Nothing yet.".to_owned(),
        created_at: chrono::DateTime::UNIX_EPOCH,
        updated_at: chrono::DateTime::UNIX_EPOCH,
        edited_at: None,
        deleted_at: None,
        attachments: vec![],
        reactions: vec![],
    }
}

/// Records what was posted and under which receipt, answering like the
/// message service does.
fn recording_messages() -> (MockMessageCommands, Arc<Mutex<Vec<(String, PostMessage)>>>) {
    let posts = Arc::new(Mutex::new(Vec::new()));
    let mut messages = MockMessageCommands::new();
    let recorded = posts.clone();
    messages.expect_post().returning(move |access, input| {
        let parent = MessageParent::Channel(Uuid::parse_str(&access.entity().entity_id).unwrap());
        let acting = access
            .acting_user_id()
            .map(|user| user.as_ref().to_owned())
            .unwrap_or_default();
        let message = posted_message(parent, input.thread_id, Uuid::from_u128(0x999));
        recorded.lock().unwrap().push((acting, input));
        Ok(message)
    });
    (messages, posts)
}

fn api(
    repo: FakeRepo,
    writers: Vec<&'static str>,
    messages: MockMessageCommands,
) -> ExternalAgentApiService<FakeRepo, FakeAccess> {
    ExternalAgentApiService::new(repo, FakeAccess { writers }, Arc::new(messages))
}

fn reply(event_id: u128) -> AgentReply {
    AgentReply {
        event_id: Uuid::from_u128(event_id),
        content: "Nothing yet.".to_owned(),
        message_id: None,
    }
}

#[tokio::test]
async fn a_direct_message_is_answered_on_its_timeline_for_its_owner() {
    let (messages, posts) = recording_messages();
    let api = api(
        repo_with(vec![event(1, ExternalAgentEventKind::DirectMessage)]),
        vec![OWNER],
        messages,
    );

    let posted = api.reply(AGENT, reply(1)).await.unwrap();

    assert_eq!(posted.parent, MessageParent::Channel(DM));
    assert_eq!(posted.thread_id, None);
    let posts = posts.lock().unwrap();
    assert_eq!(posts.len(), 1);
    let (acting_user, input) = &posts[0];
    assert_eq!(acting_user, OWNER);
    assert_eq!(input.thread_id, None);
    assert_eq!(input.content, "Nothing yet.");
    assert_eq!(input.attribution, MessageAttribution::ActingUser);
}

#[tokio::test]
async fn a_mention_is_answered_in_its_thread() {
    let (messages, posts) = recording_messages();
    let api = api(
        repo_with(vec![event(1, ExternalAgentEventKind::Mention)]),
        vec![OWNER],
        messages,
    );

    let posted = api.reply(AGENT, reply(1)).await.unwrap();

    assert_eq!(posted.parent, MessageParent::Channel(CHANNEL));
    assert_eq!(posted.thread_id, Some(Uuid::from_u128(0x700)));
    assert_eq!(posts.lock().unwrap()[0].1.thread_id, Some(Uuid::from_u128(0x700)));
}

#[tokio::test]
async fn an_agent_cannot_answer_another_agents_event() {
    let mut foreign = event(1, ExternalAgentEventKind::DirectMessage);
    foreign.bot_id = BotId::new_from_uuid(Uuid::from_u128(0xB07));
    let (messages, posts) = recording_messages();
    let api = api(repo_with(vec![foreign]), vec![OWNER], messages);

    let error = api.reply(AGENT, reply(1)).await.unwrap_err();

    assert!(matches!(error, ExternalAgentError::NotFound));
    assert!(posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn nothing_is_posted_for_someone_who_can_no_longer_write_there() {
    let (messages, posts) = recording_messages();
    let api = api(
        repo_with(vec![event(1, ExternalAgentEventKind::Mention)]),
        vec![],
        messages,
    );

    let error = api.reply(AGENT, reply(1)).await.unwrap_err();

    assert!(matches!(error, ExternalAgentError::NotFound));
    assert!(posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_empty_reply_is_refused_before_anything_is_read() {
    let (messages, posts) = recording_messages();
    let api = api(FakeRepo::default(), vec![OWNER], messages);

    let error = api
        .reply(
            AGENT,
            AgentReply {
                content: "  ".to_owned(),
                ..reply(1)
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ExternalAgentError::BadRequest(_)));
    assert!(posts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_retried_reply_whose_message_exists_reports_a_conflict() {
    let mut messages = MockMessageCommands::new();
    messages
        .expect_post()
        .returning(|_, _| Err(MessageError::Conflict));
    let api = api(
        repo_with(vec![event(1, ExternalAgentEventKind::DirectMessage)]),
        vec![OWNER],
        messages,
    );

    let error = api
        .reply(
            AGENT,
            AgentReply {
                message_id: Some(Uuid::now_v7()),
                ..reply(1)
            },
        )
        .await
        .unwrap_err();

    assert!(matches!(error, ExternalAgentError::Conflict));
}

#[tokio::test]
async fn typing_shows_where_the_answer_will_appear() {
    let typed = Arc::new(Mutex::new(Vec::new()));
    let mut messages = MockMessageCommands::new();
    let recorded = typed.clone();
    messages
        .expect_typing()
        .returning(move |access, root, active, _| {
            recorded
                .lock()
                .unwrap()
                .push((access.entity().entity_id.clone(), root, active));
            Ok(())
        });
    let api = api(
        repo_with(vec![
            event(1, ExternalAgentEventKind::DirectMessage),
            event(2, ExternalAgentEventKind::Mention),
        ]),
        vec![OWNER],
        messages,
    );

    api.set_typing(AGENT, Uuid::from_u128(1), true).await.unwrap();
    api.set_typing(AGENT, Uuid::from_u128(2), false).await.unwrap();

    assert_eq!(
        *typed.lock().unwrap(),
        vec![
            (DM.to_string(), None, true),
            (CHANNEL.to_string(), Some(Uuid::from_u128(0x700)), false),
        ],
    );
}

#[tokio::test]
async fn the_inbox_pages_forward_from_the_last_event_read() {
    let api = api(
        repo_with(vec![
            event(1, ExternalAgentEventKind::DirectMessage),
            event(2, ExternalAgentEventKind::Mention),
            event(3, ExternalAgentEventKind::DirectMessage),
        ]),
        vec![OWNER],
        MockMessageCommands::new(),
    );

    let first = api.events(AGENT, None, 2).await.unwrap();
    let rest = api.events(AGENT, Some(first[1].id), 2).await.unwrap();

    assert_eq!(
        first.iter().map(|event| event.id).collect::<Vec<_>>(),
        vec![Uuid::from_u128(1), Uuid::from_u128(2)],
    );
    assert_eq!(
        rest.iter().map(|event| event.id).collect::<Vec<_>>(),
        vec![Uuid::from_u128(3)],
    );
}
