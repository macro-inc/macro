use super::*;
use crate::domain::model::{Message, TurnId};
use crate::domain::ports::NoOpRealtime;
use crate::testing::{
    InMemoryAgentSessionRepo, RecordingComms, RecordingRealtime, test_agent_session,
};
use agent_fold::domain::fold::fold;
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
    service: AgentSessionServiceImpl<
        InMemoryAgentSessionRepo,
        StaticMessages,
        RecordingComms,
        NoOpRealtime,
    >,
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
        // Nothing here is about streaming: `append_event` is the path for a
        // session with no live actor, so there are no viewers to publish to.
        service: AgentSessionServiceImpl::new(
            repo.clone(),
            turns.clone(),
            comms.clone(),
            NoOpRealtime,
        ),
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
        NoOpRealtime,
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

// A live connection's frames do not come through `append_event` - the actor
// writes them into `PlaceholderSyncingLogs`, which folds incrementally rather
// than asking what the whole log derives. These pin that path.

/// A `PlaceholderSyncingLogs` over the given store, as `register_transport`
/// builds one for a connection - with nobody watching its channel.
fn connection<C: Comms + Clone + Send + Sync + 'static>(
    repo: InMemoryAgentSessionRepo,
    comms: C,
) -> PlaceholderSyncingLogs<InMemoryAgentSessionRepo, C, NoOpRealtime> {
    streaming_connection(repo, comms, NoOpRealtime)
}

/// The same connection, publishing its frames somewhere a test can read them.
fn streaming_connection<C, Rt>(
    repo: InMemoryAgentSessionRepo,
    comms: C,
    realtime: Rt,
) -> PlaceholderSyncingLogs<InMemoryAgentSessionRepo, C, Rt>
where
    C: Comms + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    PlaceholderSyncingLogs::new(repo, comms, realtime)
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

    /// Refusals still owed. Zero means every one budgeted has been spent, so
    /// a test can tell "refused" from "never asked".
    fn refusals_left(&self) -> usize {
        *self.refusals.lock().expect("not poisoned")
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
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("append succeeds");

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
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("append succeeds");
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
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("append succeeds");
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
        AgentSessionLogRepo::create(&first, entry)
            .await
            .expect("append succeeds");
    }
    let after_first = comms.created();
    assert_eq!(after_first, both_sides(channel, 0));

    // A second connection over the same log, as an attach would build.
    let offered_before = comms.offered();
    let second = connection(repo.clone(), comms.clone());
    AgentSessionLogRepo::create(&second, any_event(test_session()))
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

    // Drive up to and including the prompt - the fixture opens with handshake
    // traffic, and the prompt is the first frame that derives anything.
    let mut log = parse_log_as(test_session(), TURN).into_iter();
    for entry in log.by_ref() {
        let is_prompt = entry.user_id.is_some();
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("a refused placeholder does not fail the append");
        if is_prompt {
            break;
        }
    }
    assert_eq!(
        comms.refusals_left(),
        0,
        "the prompt's placeholder was offered, and refused"
    );
    assert_eq!(comms.inner.created(), vec![], "so nothing was written");

    // Everything the fixture derives still lands, the refused message
    // included.
    for entry in log {
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("append succeeds");
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
        AgentSessionLogRepo::create(&first, entry)
            .await
            .expect("append succeeds");
    }
    assert_eq!(comms.created(), both_sides(channel, 0));

    // A second connection over the same log, then a fresh prompt.
    let second = connection(repo.clone(), comms.clone());
    for entry in parse_log_as(test_session(), SECOND_PROMPT) {
        AgentSessionLogRepo::create(&second, entry)
            .await
            .expect("append succeeds");
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

// Streaming: the same writer that keeps the channel's placeholders in step
// pushes each folded message a frame changes at whoever is watching the
// channel right now.

/// A viewer who replaces whatever it holds under each published message's key
/// ends up with exactly what folding the whole log derives - the property the
/// client relies on instead of folding anything itself. Along the way: events
/// address the session's channel, frames that change nothing publish nothing,
/// a message is `New` exactly once, and `log_index` advances with the log so
/// events can be aligned against a fetched snapshot.
#[tokio::test]
async fn published_messages_replay_to_what_the_log_folds_to() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let realtime = RecordingRealtime::new();
    let logs = streaming_connection(repo.clone(), RecordingComms::new(), realtime.clone());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len() as u64;
    for entry in log.clone() {
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("append succeeds");
    }

    let published = realtime.published();
    assert!(!published.is_empty(), "the fixture derives messages");
    assert!(
        published.len() < log.len(),
        "most frames are handshakes and bookkeeping - publishing one event \
         per frame would mean the fold is not deciding what goes out"
    );
    assert!(
        published
            .iter()
            .all(|event| event.channel_id == channel && event.agent_session_id == test_session()),
        "every event names the session's channel and the session"
    );

    let mut indices = published.iter().map(|event| event.log_index);
    let mut previous = 0;
    assert!(
        indices.all(|index| {
            let ordered = index > previous && index <= frames;
            previous = index;
            ordered
        }),
        "log_index advances with the log, never past it"
    );

    // Apply the events the way a viewer does: `New` appends, `Updated`
    // replaces in place.
    let mut held: Vec<FoldedMessage> = Vec::new();
    for event in published {
        let key = event.message.id();
        match event.change {
            crate::domain::model::FoldedMessageChange::New => {
                assert!(
                    held.iter().all(|message| message.id() != key),
                    "{key} was reported new twice"
                );
                held.push(event.message);
            }
            crate::domain::model::FoldedMessageChange::Updated => {
                let slot = held
                    .iter_mut()
                    .find(|message| message.id() == key)
                    .expect("an update names a message already reported new");
                *slot = event.message;
            }
        }
    }
    assert_eq!(
        held,
        fold(log),
        "replaying the stream reproduces the fold of the whole log"
    );
}

/// Streaming costs the connection one session lookup, not one per frame.
///
/// A frame names only its session and streaming addresses a channel, so the
/// obvious implementation reads the session every time - and most frames are
/// stream chunks that otherwise cost nothing but the log insert. The writer
/// remembers the channel instead, and takes it from the read `place` was
/// making anyway when there is one.
#[tokio::test]
async fn streaming_costs_one_session_lookup_for_the_whole_connection() {
    /// Replay the fixture through a connection publishing to `realtime`, and
    /// report what it read and how many frames it took to get there.
    async fn replay<Rt>(realtime: Rt) -> (usize, usize)
    where
        Rt: AgentSessionRealtime + Send + Sync + 'static,
    {
        let repo = InMemoryAgentSessionRepo::new();
        repo.insert_session(test_agent_session(test_session(), Uuid::from_u128(0xc4a2)));
        let logs = streaming_connection(repo.clone(), RecordingComms::new(), realtime);

        let log = parse_log_as(test_session(), TURN);
        let frames = log.len();
        for entry in log {
            AgentSessionLogRepo::create(&logs, entry)
                .await
                .expect("append succeeds");
        }
        (repo.session_reads(), frames)
    }

    let (streamed, frames) = replay(RecordingRealtime::new()).await;
    let (silent, _) = replay(NoOpRealtime).await;

    assert!(frames > 5, "the fixture is worth counting reads over");
    assert!(
        streamed <= silent + 1,
        "{frames} streamed frames read the session {streamed} times against \
         {silent} unstreamed - that is a lookup per frame, not one per connection"
    );
}

/// A publisher that is down costs a viewer some liveness and nothing else:
/// the append succeeds, the log is written, and the channel is still placed.
#[tokio::test]
async fn a_failed_publish_does_not_fail_the_append() {
    let repo = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    repo.insert_session(test_agent_session(test_session(), channel));
    let comms = RecordingComms::new();
    let logs = streaming_connection(repo.clone(), comms.clone(), RecordingRealtime::down());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    for entry in log {
        AgentSessionLogRepo::create(&logs, entry)
            .await
            .expect("a refused publish does not fail the append");
    }

    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(stored.len(), frames, "every frame is still durable");
    assert_eq!(
        comms.created(),
        both_sides(channel, 0),
        "and the channel is still placed"
    );
}

/// `channel_messages` resolves a dedicated channel to its session and hands
/// back the fold of its whole log, stamped with the frame count it was folded
/// from - the pair a reader aligns the live stream against.
#[tokio::test]
async fn channel_messages_returns_the_folded_log() {
    let store = InMemoryAgentSessionRepo::new();
    let channel = Uuid::from_u128(0xc4a2);
    store.insert_session(test_agent_session(test_session(), channel));
    let recorded = parse_log_as(test_session(), TURN);
    store.extend_log(recorded.clone());

    let service = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        RecordingComms::new(),
        NoOpRealtime,
    );

    let folded = service
        .channel_messages(channel)
        .await
        .expect("lookup succeeds")
        .expect("the channel belongs to a session");

    assert_eq!(folded.agent_session_id, test_session());
    assert_eq!(folded.bot.name, "Test Agent");
    assert_eq!(
        folded.log_length,
        recorded.len() as u64,
        "the snapshot names how many frames it folded"
    );
    assert_eq!(
        folded.messages,
        fold(recorded),
        "the served messages are the fold of the stored log"
    );
}

/// A channel no session owns yields `None`, not an error.
#[tokio::test]
async fn channel_messages_without_a_session_is_none() {
    let fx = fixture();

    let folded = fx
        .service
        .channel_messages(Uuid::from_u128(0xffff))
        .await
        .expect("lookup succeeds");

    assert!(folded.is_none());
}
