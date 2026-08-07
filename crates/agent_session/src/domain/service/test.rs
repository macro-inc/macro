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

// A live connection's frames do not come through `append_event` - the actor
// writes them into `PlaceholderSyncingLogs`, which folds incrementally rather
// than asking what the whole log derives. These pin that path.

/// A `PlaceholderSyncingLogs` over the given store, as `register_transport`
/// builds one for a connection.
fn connection<C: Comms + Clone + Send + Sync + 'static>(
    repo: InMemoryAgentSessionRepo,
    comms: C,
) -> PlaceholderSyncingLogs<InMemoryAgentSessionRepo, C> {
    PlaceholderSyncingLogs {
        repo,
        comms,
        state: tokio::sync::Mutex::new(PlaceholderState::default()),
    }
}

/// A [`Comms`] that refuses the first `n` placeholder writes, so a test can
/// see what happens to a message the fold has already announced.
#[derive(Clone)]
struct FlakyComms {
    inner: RecordingComms,
    refusals: Arc<Mutex<usize>>,
}

impl FlakyComms {
    fn refusing(n: usize) -> Self {
        Self {
            inner: RecordingComms::new(),
            refusals: Arc::new(Mutex::new(n)),
        }
    }
}

impl Comms for FlakyComms {
    async fn messages_with_placeholders(
        &self,
        session: &AgentSession,
    ) -> Result<std::collections::HashSet<MessageId>, rootcause::Report> {
        self.inner.messages_with_placeholders(session).await
    }

    async fn create_message_placeholder(
        &self,
        session: &AgentSession,
        id: MessageId,
        author: &Author,
    ) -> Result<(), rootcause::Report> {
        let refuse = {
            let mut left = self.refusals.lock().expect("not poisoned");
            let refuse = *left > 0;
            *left = left.saturating_sub(1);
            refuse
        };
        if refuse {
            return Err(rootcause::report!("comms is down"));
        }
        self.inner
            .create_message_placeholder(session, id, author)
            .await
    }
}

/// The live path, on a real recording: the same placeholders as the refolding
/// path, one per folded message and never twice.
#[tokio::test]
async fn a_connections_frames_place_one_placeholder_per_folded_message() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = RecordingComms::new();
    let logs = connection(repo.clone(), comms.clone());

    for entry in parse_log_as(test_session(), TURN) {
        logs.create(entry).await.expect("append succeeds");

        let created = comms.created();
        let unique: std::collections::HashSet<_> = created.iter().collect();
        assert_eq!(unique.len(), created.len(), "no placeholder written twice");
    }

    assert_eq!(comms.created(), both_sides(channel, 0));
}

/// The point of the rework: a connection folds its session once, when it
/// starts, and every frame after that is folded into the state it kept.
///
/// Reading the whole log is what folding from scratch costs, so a read per
/// frame is exactly the quadratic behaviour this replaced.
#[tokio::test]
async fn a_connection_reads_the_log_once_however_many_frames_arrive() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let logs = connection(repo.clone(), RecordingComms::new());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    assert!(frames > 5, "the fixture is worth counting reads over");

    for entry in log {
        logs.create(entry).await.expect("append succeeds");
    }

    assert_eq!(
        repo.log_reads(),
        1,
        "{frames} frames should cost one fold, not one per frame"
    );
}

/// The agent's placeholder is written while its turn is still running, not
/// held back until the turn stops - so a channel has somewhere to render the
/// reply as it streams.
#[tokio::test]
async fn the_agents_placeholder_appears_before_its_turn_ends() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = RecordingComms::new();
    let logs = connection(repo.clone(), comms.clone());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    let agent_side = (
        channel,
        MessageId {
            turn: TurnId(0),
            author: AuthorKind::Agent,
        },
    );

    let mut placed_at = None;
    for (index, entry) in log.into_iter().enumerate() {
        logs.create(entry).await.expect("append succeeds");
        if placed_at.is_none() && comms.created().contains(&agent_side) {
            placed_at = Some(index);
        }
    }

    let placed_at = placed_at.expect("the agent's placeholder was written");
    assert!(
        placed_at < frames - 1,
        "placed at frame {placed_at} of {frames}, not once the turn had ended"
    );
}

/// Re-attaching to a session that is already rendered leaves the channel
/// alone.
///
/// The reconnected fold catches up on the stored log and so re-derives every
/// message the first connection did. Nothing filters those out - they are
/// offered to comms again and the unique index absorbs them, which is the
/// trade this path makes: one redundant write per message per connection
/// instead of a query per connection to find out they exist.
#[tokio::test]
async fn re_attaching_does_not_place_a_message_twice() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = RecordingComms::new();

    // A first connection folds the whole recording.
    let first = connection(repo.clone(), comms.clone());
    for entry in parse_log_as(test_session(), TURN) {
        first.create(entry).await.expect("append succeeds");
    }
    let after_first = comms.created();
    assert_eq!(after_first, both_sides(channel, 0));

    // A second connection over the same log, as an attach would build.
    let offered_before = comms.offered();
    let second = connection(repo.clone(), comms.clone());
    second
        .create(any_event(test_session()))
        .await
        .expect("append succeeds");

    assert_eq!(
        comms.created(),
        after_first,
        "a re-attached connection re-derives the log but adds no rows"
    );
    assert_eq!(
        comms.offered() - offered_before,
        after_first.len(),
        "and gets there by re-offering them, not by checking first"
    );
}

/// A message the fold announced but comms refused is not lost. The fold names
/// a message once, so the connection has to remember it and try again.
#[tokio::test]
async fn a_refused_placeholder_is_retried_on_the_next_frame() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = FlakyComms::refusing(1);
    let logs = connection(repo.clone(), comms.clone());

    let mut log = parse_log_as(test_session(), TURN).into_iter();

    // The prompt derives the user's message, and comms refuses it.
    logs.create(log.next().expect("the fixture opens with a prompt"))
        .await
        .expect("a refused placeholder does not fail the append");
    assert_eq!(comms.inner.created(), vec![], "the write was refused");

    // Everything the fixture derives still lands, the refused message
    // included.
    for entry in log {
        logs.create(entry).await.expect("append succeeds");
    }
    assert_eq!(
        comms.inner.created(),
        both_sides(channel, 0),
        "the refused message was retried, and in fold order"
    );
}

/// One more prompt, to see what turn a reconnected session gives it.
const SECOND_PROMPT: &str = r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"p2","method":"session/prompt","params":{"sessionId":"s","prompt":[{"type":"text","text":"and again"}]}}}"#;

/// What catching up is actually for: a connection that inherits a log keeps
/// counting turns from where the log left off.
///
/// A fold starting empty would call this prompt `TurnId(0)`, key it to the
/// placeholder turn 0 already owns, and have it swallowed as a duplicate - so
/// it would render nowhere, while a channel load folding the whole log went
/// on deriving it as turn 1. No unique index catches that; the ids are simply
/// wrong.
#[tokio::test]
async fn a_re_attached_connection_keeps_counting_turns_from_the_log() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = RecordingComms::new();

    let first = connection(repo.clone(), comms.clone());
    for entry in parse_log_as(test_session(), TURN) {
        first.create(entry).await.expect("append succeeds");
    }
    assert_eq!(comms.created(), both_sides(channel, 0));

    // A second connection over the same log, then a fresh prompt.
    let second = connection(repo.clone(), comms.clone());
    for entry in parse_log_as(test_session(), SECOND_PROMPT) {
        second.create(entry).await.expect("append succeeds");
    }

    let mut expected = both_sides(channel, 0);
    expected.push((
        channel,
        MessageId {
            turn: TurnId(1),
            author: AuthorKind::User,
        },
    ));
    assert_eq!(
        comms.created(),
        expected,
        "the prompt after a re-attach is turn 1, not turn 0 over again"
    );
}
