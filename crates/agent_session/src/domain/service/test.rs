use super::*;
use crate::domain::model::Message;
use crate::domain::ports::NoOpRealtime;
use crate::testing::{InMemoryAgentSessionRepo, RecordingRealtime, test_agent_session};
use agent_fold::domain::fold::fold;
use agent_fold::domain::service::FoldedMessageService;
use agent_fold::testing::{TURN, parse_log_as, test_session};
use agent_runtime_protocol::domain::schema::v0::ToServerMessage;
use macro_uuid::Uuid;

struct Fixture {
    service: AgentSessionServiceImpl<
        InMemoryAgentSessionRepo,
        FoldedMessageService<InMemoryAgentSessionRepo>,
        NoOpRealtime,
    >,
    repo: InMemoryAgentSessionRepo,
    session: AgentSessionId,
}

fn fixture() -> Fixture {
    let repo = InMemoryAgentSessionRepo::new();
    let session = AgentSessionId::new_from_uuid(Uuid::from_u128(1));
    repo.insert_session(test_agent_session(session));

    Fixture {
        // Nothing here is about streaming, so there are no viewers to publish
        // to.
        service: AgentSessionServiceImpl::new(
            repo.clone(),
            FoldedMessageService::new(repo.clone()),
            NoOpRealtime,
        ),
        repo,
        session,
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

// A live session's frames go into `LiveSessionLogWriter`, which the actor
// owns. These pin that path.

/// A `LiveSessionLogWriter` over the given store, as `register_transport`
/// builds one for a connection - with nobody watching its channel.
fn connection(
    repo: InMemoryAgentSessionRepo,
) -> LiveSessionLogWriter<InMemoryAgentSessionRepo, NoOpRealtime> {
    streaming_connection(repo, NoOpRealtime)
}

/// The same connection, publishing its frames somewhere a test can read them.
fn streaming_connection<Rt>(
    repo: InMemoryAgentSessionRepo,
    realtime: Rt,
) -> LiveSessionLogWriter<InMemoryAgentSessionRepo, Rt>
where
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    LiveSessionLogWriter::new(repo, realtime)
}

/// Every frame handed to a connection is stored, whether or not it derives
/// anything.
#[tokio::test]
async fn appending_persists_the_event() {
    let fx = fixture();
    let mut logs = connection(fx.repo.clone());

    AgentSessionLogWriter::append(&mut logs, any_event(fx.session))
        .await
        .expect("append succeeds");
    AgentSessionLogWriter::append(&mut logs, any_event(fx.session))
        .await
        .expect("append succeeds");

    let log = AgentSessionLogRepo::list_by_session(&fx.repo, fx.session)
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(log.len(), 2);
}

/// The point of the rework: a connection folds its session once, when it
/// starts, and every frame after that is folded into the state it kept.
///
/// Reading the whole log is what folding from scratch costs, so a read per
/// frame is exactly the quadratic behaviour this replaced.
#[tokio::test]
async fn a_connection_reads_the_log_once_however_many_frames_arrive() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let mut logs = connection(repo.clone());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    assert!(frames > 5, "the fixture is worth counting reads over");

    for entry in log {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("append succeeds");
    }

    assert_eq!(
        repo.log_reads(),
        1,
        "{frames} frames should cost one fold, not one per frame"
    );
}

// Streaming: the writer every frame of a connected session passes through
// pushes each one at whoever is watching the channel right now.

/// Every frame a connection writes goes out once, addressed at the session's
/// channel and carrying the frame verbatim - a viewer folds what it is sent
/// with the same code that folds the fetched log, so anything altered on the
/// way out would fold to something else.
#[tokio::test]
async fn a_connections_frames_are_published_to_its_channel() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let realtime = RecordingRealtime::new();
    let mut logs = streaming_connection(repo.clone(), realtime.clone());

    let log = parse_log_as(test_session(), TURN);
    for entry in log.clone() {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("append succeeds");
    }

    let published = realtime.published();
    assert_eq!(published.len(), log.len(), "one event per frame, no more");
    assert!(
        published
            .iter()
            .all(|event| event.agent_session_id == test_session()),
        "every event names the session"
    );
    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .expect("stored log can be read");
    assert_eq!(
        published
            .iter()
            .map(|event| event.entry.created_at)
            .collect::<Vec<_>>(),
        stored
            .iter()
            .map(|entry| entry.created_at)
            .collect::<Vec<_>>(),
        "published timestamps are the timestamps assigned by persistence"
    );
    // Compared as the JSON they are published as: the client folds these
    // bytes with the same code it folds the fetched log with.
    let frame = |entry: AgentSessionLog| {
        (
            entry.user_id.map(|user| user.to_string()),
            serde_json::to_value(entry.content).expect("a frame serializes"),
        )
    };
    assert_eq!(
        published
            .into_iter()
            .map(|event| frame(event.entry.entry))
            .collect::<Vec<_>>(),
        log.into_iter().map(frame).collect::<Vec<_>>(),
        "the frames go out as they were logged"
    );
}

/// Streaming costs the connection one session lookup, not one per frame.
///
/// Most frames are stream chunks that otherwise cost nothing but the log
/// insert, so the audience lookup must not be per frame.
#[tokio::test]
async fn streaming_costs_one_session_lookup_for_the_whole_connection() {
    /// Replay the fixture through a connection publishing to `realtime`, and
    /// report what it read and how many frames it took to get there.
    async fn replay<Rt>(realtime: Rt) -> (usize, usize)
    where
        Rt: AgentSessionRealtime + Send + Sync + 'static,
    {
        let repo = InMemoryAgentSessionRepo::new();
        repo.insert_session(test_agent_session(test_session()));
        let mut logs = streaming_connection(repo.clone(), realtime);

        let log = parse_log_as(test_session(), TURN);
        let frames = log.len();
        for entry in log {
            AgentSessionLogWriter::append(&mut logs, entry)
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
/// the append succeeds and the log is written.
#[tokio::test]
async fn a_failed_publish_does_not_fail_the_append() {
    let repo = InMemoryAgentSessionRepo::new();
    repo.insert_session(test_agent_session(test_session()));
    let mut logs = streaming_connection(repo.clone(), RecordingRealtime::down());

    let log = parse_log_as(test_session(), TURN);
    let frames = log.len();
    for entry in log {
        AgentSessionLogWriter::append(&mut logs, entry)
            .await
            .expect("a refused publish does not fail the append");
    }

    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .expect("in-memory repo cannot fail");
    assert_eq!(stored.len(), frames, "every frame is still durable");
}

/// `session_log` hands back the log unfolded, in order, with the agent that
/// wrote it.
#[tokio::test]
async fn session_log_returns_the_sessions_frames_in_order() {
    let store = InMemoryAgentSessionRepo::new();
    store.insert_session(test_agent_session(test_session()));
    let recorded = parse_log_as(test_session(), TURN);
    store.extend_log(recorded.clone());

    let service = AgentSessionServiceImpl::new(
        store.clone(),
        FoldedMessageService::new(store.clone()),
        NoOpRealtime,
    );

    let log = service
        .session_log(test_session())
        .await
        .expect("lookup succeeds");

    assert_eq!(
        log.entries.len(),
        recorded.len(),
        "every frame is served, none folded away"
    );
    assert!(!log.bot.name.is_empty(), "the response names the agent");

    // The order is the contract: folding is a left fold from the first frame,
    // so a reordered log derives different turn numbering.
    let served = fold(log.entries.into_iter().map(|stored| stored.entry));
    assert_eq!(
        served,
        fold(recorded),
        "the served log folds to what the stored one does"
    );
}

/// A session that never existed is an error: the response has to name the
/// session's agent, and there is none to name.
#[tokio::test]
async fn session_log_of_an_unknown_session_errors() {
    let fx = fixture();

    let log = fx.service.session_log(AgentSessionId::TEST_A).await;

    assert!(log.is_err());
}

/// A config-bearing response moves the fold's model, and the writer projects
/// it onto the session row; an error response projects nothing.
#[tokio::test]
async fn appending_a_config_response_projects_the_model() {
    let fx = fixture();
    let mut logs = connection(fx.repo.clone());

    let frames = parse_log_as(
        fx.session,
        concat!(
            r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"n","method":"session/new","params":{"cwd":"/w","mcpServers":[]}}}"#,
            "\n",
            r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"n","result":{"sessionId":"s1","configOptions":[{"id":"model","name":"Model","type":"select","currentValue":"sonnet","options":[{"value":"sonnet","name":"Sonnet"},{"value":"opus","name":"Opus"}]}]}}}"#,
            "\n",
            r#"{"direction":"to_runtime","content":{"type":"acp","jsonrpc":"2.0","id":"c","method":"session/set_config_option","params":{"sessionId":"s1","configId":"model","value":"claude-fable-5"}}}"#,
            "\n",
            r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","id":"c","error":{"code":-32602,"message":"Invalid params: model not found: claude-fable-5"}}}"#,
        ),
    );
    for frame in frames {
        AgentSessionLogWriter::append(&mut logs, frame)
            .await
            .expect("append succeeds");
    }

    let session = AgentSessionRepo::get(&fx.repo, fx.session)
        .await
        .expect("get session");
    assert_eq!(session.model, "sonnet", "the rejected change moved nothing");
}
