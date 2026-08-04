use super::*;
use crate::domain::model::{Message, TurnId};
use crate::testing::{InMemoryAgentSessionRepo, RecordingComms, test_agent_session};
use agent_fold::domain::model::{Author, AuthorKind, FoldedMessage, MessageId, MessagePart};
use agent_fold::domain::service::FoldedMessageService;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use macro_uuid::Uuid;
use non_empty::NonEmpty;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// A bare folded message for `turn`, authored by `author`. Only its key and
/// author matter here - the service reads nothing else.
fn folded(turn: u32, author: Author) -> FoldedMessage {
    FoldedMessage {
        id: TurnId(turn),
        author,
        parts: NonEmpty::new(vec![MessagePart::Text("x".to_owned())])
            .expect("one part is not empty"),
        stop: None,
    }
}

/// A [`FoldedMessageRepo`] answering from a preset table, standing in for the
/// fold.
#[derive(Debug, Clone, Default)]
struct StaticMessages {
    messages: Arc<Mutex<HashMap<AgentSessionId, Vec<FoldedMessage>>>>,
}

impl StaticMessages {
    /// Set the session's messages to both sides of each given turn, which is
    /// what a completed turn folds to.
    fn set(&self, session: AgentSessionId, turns: impl IntoIterator<Item = u32>) {
        let messages = turns
            .into_iter()
            .flat_map(|turn| {
                [
                    folded(turn, Author::User(None)),
                    folded(turn, Author::Agent),
                ]
            })
            .collect();
        self.messages
            .lock()
            .expect("message table is not poisoned")
            .insert(session, messages);
    }
}

impl FoldedMessageRepo for StaticMessages {
    async fn messages(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<FoldedMessage>, rootcause::Report> {
        Ok(self
            .messages
            .lock()
            .expect("message table is not poisoned")
            .get(&session)
            .cloned()
            .unwrap_or_default())
    }

    async fn get_message(
        &self,
        _session: AgentSessionId,
        _id: MessageId,
    ) -> Result<Option<FoldedMessage>, rootcause::Report> {
        Ok(None)
    }

    async fn message_ids(
        &self,
        session: AgentSessionId,
    ) -> Result<Vec<MessageId>, rootcause::Report> {
        Ok(FoldedMessageRepo::messages(self, session)
            .await?
            .iter()
            .map(FoldedMessage::id)
            .collect())
    }
}

/// Both placeholder keys a completed turn produces, in fold order.
fn both_sides(channel: Uuid, turn: u32) -> Vec<(Uuid, MessageId)> {
    vec![
        (
            channel,
            MessageId {
                turn: TurnId(turn),
                author: AuthorKind::User,
            },
        ),
        (
            channel,
            MessageId {
                turn: TurnId(turn),
                author: AuthorKind::Agent,
            },
        ),
    ]
}

struct Fixture {
    service: AgentSessionServiceImpl<InMemoryAgentSessionRepo, StaticMessages, RecordingComms>,
    repo: InMemoryAgentSessionRepo,
    turns: StaticMessages,
    comms: RecordingComms,
    session: AgentSessionId,
    channel: Uuid,
}

fn fixture() -> Fixture {
    let repo = InMemoryAgentSessionRepo::new();
    let turns = StaticMessages::default();
    let comms = RecordingComms::new();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(session, channel));

    Fixture {
        service: AgentSessionServiceImpl::new(repo.clone(), turns.clone(), comms.clone()),
        repo,
        turns,
        comms,
        session,
        channel,
    }
}

/// Any protocol frame will do: the service only stores it, turn detection is
/// the fold's answer.
fn any_event(session: AgentSessionId) -> AgentSessionLog {
    AgentSessionLog {
        agent_session_id: session,
        user_id: None,
        content: Message::ToServer(ToServerMessage::Event {
            event: agent_runtime_protocol::domain::schema::v0::SystemEvent::AcpReady,
        }),
    }
}

/// An append that derives messages comms has not seen writes one placeholder
/// each - both sides of the turn, separately keyed.
#[tokio::test]
async fn appending_a_new_turn_creates_a_placeholder_per_side() {
    let fx = fixture();
    fx.turns.set(fx.session, [0]);

    fx.service
        .append_event(any_event(fx.session))
        .await
        .expect("append succeeds");

    assert_eq!(fx.comms.created(), both_sides(fx.channel, 0));
}

/// The event is persisted to the log whether or not it opens a turn.
#[tokio::test]
async fn appending_persists_the_event() {
    let fx = fixture();

    fx.service
        .append_event(any_event(fx.session))
        .await
        .expect("append succeeds");
    fx.service
        .append_event(any_event(fx.session))
        .await
        .expect("append succeeds");

    let log = AgentSessionLogRepo::list_by_session(&fx.repo, fx.session)
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(log.len(), 2);
    assert_eq!(fx.comms.created(), vec![], "no messages, no placeholders");
}

/// A message that already has a placeholder is not written again; only the
/// newly derived ones are.
#[tokio::test]
async fn only_unseen_messages_get_placeholders() {
    let fx = fixture();
    fx.turns.set(fx.session, [0]);
    fx.service
        .append_event(any_event(fx.session))
        .await
        .expect("append succeeds");

    // The next event closes turn 0 and opens turn 1: the fold now derives
    // both, but only turn 1 is missing a placeholder.
    fx.turns.set(fx.session, [0, 1]);
    fx.service
        .append_event(any_event(fx.session))
        .await
        .expect("append succeeds");

    let mut expected = both_sides(fx.channel, 0);
    expected.extend(both_sides(fx.channel, 1));
    assert_eq!(
        fx.comms.created(),
        expected,
        "each message gets exactly one placeholder, in order"
    );
}

/// Appends land on the appended session's channel, not anyone else's.
#[tokio::test]
async fn placeholders_are_scoped_to_the_session() {
    let fx = fixture();
    let other = AgentSessionId::new_from_uuid(Uuid::from_u128(2));
    let other_channel = Uuid::from_u128(0xc4a3);
    fx.repo
        .insert_session(test_agent_session(other, other_channel));

    fx.turns.set(fx.session, [0]);
    fx.turns.set(other, [0]);

    fx.service
        .append_event(any_event(other))
        .await
        .expect("append succeeds");

    assert_eq!(
        fx.comms.created(),
        both_sides(other_channel, 0),
        "only the appended session's channel is written to"
    );
}

/// The whole loop, on a real recording: the service appends each protocol
/// frame, `agent_fold` refolds the log, and a comms placeholder appears for
/// each side as the fold derives it - the user's when the prompt opens the
/// turn, the agent's once it has content - and never twice.
#[tokio::test]
async fn appends_place_one_comms_placeholder_per_folded_message() {
    let store = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    store.insert_session(test_agent_session(test_session(), channel));

    let comms = RecordingComms::new();
    let service = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        comms.clone(),
    );

    let mut prompt_seen = false;
    for entry in parse_log_as(test_session(), TURN) {
        // The fixture attributes exactly the prompt frames to a user.
        prompt_seen |= entry.user_id.is_some();

        service.append_event(entry).await.expect("append succeeds");

        let created = comms.created();
        assert!(
            created.len() <= 2,
            "one turn folds to at most two messages, got {created:?}"
        );
        assert!(
            created.iter().all(|(written, _)| *written == channel),
            "placeholders land on the session's channel"
        );
        let unique: std::collections::HashSet<_> = created.iter().collect();
        assert_eq!(unique.len(), created.len(), "no placeholder written twice");
        if !prompt_seen {
            assert!(created.is_empty(), "nothing renders before the prompt");
        }
    }
    assert!(prompt_seen, "fixture contains a prompt");
    assert_eq!(
        comms.created(),
        both_sides(channel, 0),
        "the completed turn ends with both sides placed"
    );
}

/// `channel_messages` resolves a dedicated channel to its session and folds
/// that session's log.
#[tokio::test]
async fn channel_messages_folds_the_channels_session() {
    let store = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    store.insert_session(test_agent_session(test_session(), channel));
    store.extend_log(parse_log_as(test_session(), TURN));

    let service = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        RecordingComms::new(),
    );

    let folded = service
        .channel_messages(channel)
        .await
        .expect("lookup succeeds")
        .expect("the channel belongs to a session");

    assert_eq!(folded.agent_session_id, test_session());
    assert!(
        !folded.messages.is_empty(),
        "the recorded turn folds to messages"
    );
}

/// A channel no session owns yields `None`, not an error.
#[tokio::test]
async fn channel_messages_without_a_session_is_none() {
    let fx = fixture();
    let unowned_channel = Uuid::from_u128(0xffff);

    let folded = fx
        .service
        .channel_messages(unowned_channel)
        .await
        .expect("lookup succeeds");

    assert!(folded.is_none());
}
