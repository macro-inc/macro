use super::*;
use crate::domain::error::SessionError;
use crate::domain::event::CursorEvent;
use crate::domain::model::{McpHeader, McpServer, McpTransport, RepoUrl, RunOutcome, RunStatus};
use crate::testing::{CursorCall, FakeCursor, FixedRepos, RecordingNotifier};
use agent_client_protocol::schema::v1::{SessionUpdate, StopReason};
use std::path::Path;

type Service = CursorSessionService<FakeCursor, RecordingNotifier, FixedRepos>;

fn service(repo: Option<RepoUrl>) -> (Arc<Service>, FakeCursor, RecordingNotifier) {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(repo),
    ));
    (service, cursor, notifier)
}

fn finished(run: &str) -> CursorEvent {
    CursorEvent::Result {
        run_id: CursorRunId::new(run),
        status: RunStatus::Finished,
        text: None,
        duration_ms: Some(1),
    }
}

#[tokio::test]
async fn first_prompt_creates_the_agent_with_the_session_repo() {
    let repo = RepoUrl::parse("https://github.com/macro-inc/macro").expect("valid repo");
    let (service, cursor, notifier) = service(Some(repo.clone()));
    let session = service.new_session(Path::new("/workspace"), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Assistant {
            text: "hello".to_owned(),
        })
        .expect("stream open");
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = service
        .prompt(&session, "do it")
        .await
        .expect("prompt runs");
    assert_eq!(stop, StopReason::EndTurn);
    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CreateAgent(
            "do it".to_owned(),
            Some(repo),
            Vec::new()
        )]
    );
    let updates = notifier.updates();
    assert_eq!(updates.len(), 1);
    assert!(matches!(updates[0].1, SessionUpdate::AgentMessageChunk(_)));
}

#[tokio::test]
async fn second_prompt_follows_up_on_the_same_agent() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    for run in 1..=2 {
        let events = cursor.script_stream();
        // A real run always ends with a `result`; a stream that just stops is
        // a truncated one, which is now an error.
        events
            .send(finished(&format!("run-fake-{run}")))
            .expect("stream open");
        events.send(CursorEvent::Done).expect("stream open");
        service
            .prompt(&session, "again")
            .await
            .expect("prompt runs");
    }

    let calls = cursor.calls();
    assert!(matches!(calls[0], CursorCall::CreateAgent(..)));
    assert!(matches!(calls[1], CursorCall::CreateRun(..)));
}

#[tokio::test]
async fn cancel_mid_turn_cancels_the_run_and_reports_cancelled() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });

    // Let the turn reach its stream, observed by its first delivered update.
    events
        .send(CursorEvent::Assistant {
            text: "working".to_owned(),
        })
        .expect("stream open");
    while notifier.updates().is_empty() {
        tokio::task::yield_now().await;
    }

    service.cancel(&session).await.expect("cancel works");
    drop(events); // the server closes the stream after a cancel

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
    assert!(
        cursor
            .calls()
            .iter()
            .any(|call| matches!(call, CursorCall::CancelRun(..)))
    );
}

#[tokio::test]
async fn concurrent_prompt_on_an_active_turn_is_rejected() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "first").await }
    });
    events
        .send(CursorEvent::Assistant {
            text: "…".to_owned(),
        })
        .expect("stream open");
    while notifier.updates().is_empty() {
        tokio::task::yield_now().await;
    }

    let second = service.prompt(&session, "second").await;
    assert!(matches!(second, Err(SessionError::TurnAlreadyActive(_))));

    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    turn.await
        .expect("task joins")
        .expect("first prompt resolves");
}

#[tokio::test]
async fn unknown_session_is_an_error() {
    let (service, _cursor, _notifier) = service(None);
    let missing = AcpSessionId::new("nope");
    assert!(matches!(
        service.prompt(&missing, "hi").await,
        Err(SessionError::UnknownSession(_))
    ));
}

#[tokio::test]
async fn a_cancelled_result_reports_cancelled_without_a_client_cancel() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Cancelled,
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = service.prompt(&session, "hi").await.expect("prompt runs");
    assert_eq!(stop, StopReason::Cancelled);
}

#[tokio::test]
async fn a_stream_error_falls_back_to_polling_the_result() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Error {
            code: Some("stream_unavailable".to_owned()),
            message: "Run stream is no longer available".to_owned(),
        })
        .expect("stream open");
    // The run itself finished fine server-side - observed for real: the
    // stream refused while `GET .../runs/{run}` already had the answer.
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("the answer".to_owned()),
    });

    let stop = service
        .prompt(&session, "hi")
        .await
        .expect("the turn must survive a dead stream");
    assert_eq!(stop, StopReason::EndTurn);
    // The polled answer was delivered even though nothing streamed.
    assert!(!notifier.updates().is_empty());
}

/// When both the stream and the poll fail, the turn fails - there is no
/// third way to learn the outcome.
#[tokio::test(start_paused = true)]
async fn a_turn_fails_when_the_stream_and_the_poll_both_fail() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Error {
            code: Some("boom".to_owned()),
            message: "stream exploded".to_owned(),
        })
        .expect("stream open");
    // No scripted run results: every poll errors.

    assert!(matches!(
        service.prompt(&session, "hi").await,
        Err(SessionError::Cursor(_))
    ));
}

/// A run that ended in `Error` is a failed turn, not a clean one.
///
/// ACP answers a prompt with either a stop reason or an error; reporting
/// `EndTurn` for a crashed run tells the client the work succeeded.
#[tokio::test]
async fn an_error_run_status_fails_the_turn() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Error,
            text: None,
            duration_ms: Some(1),
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    assert!(
        matches!(
            service.prompt(&session, "hi").await,
            Err(SessionError::Cursor(_))
        ),
        "a run that ended in Error must not report a stop reason"
    );
}

/// A terminal status this crate does not know is not a success either.
///
/// `RunStatus::Unknown` absorbs any status Cursor adds, so treating it as a
/// clean finish would silently report success for an outcome nobody has read
/// yet. The cost is that renaming `FINISHED` upstream fails loudly rather
/// than quietly - which is the right way round.
#[tokio::test]
async fn an_unknown_terminal_status_fails_the_turn() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Unknown("EXPLODED".to_owned()),
            text: None,
            duration_ms: None,
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    assert!(matches!(
        service.prompt(&session, "hi").await,
        Err(SessionError::Cursor(_))
    ));
}

/// A stream that ends without a `result` never reported an outcome.
///
/// [`crate::domain::ports::RunStream`] says so in as many words: a consumer
/// that never sees a terminal result "must treat the run's outcome as unknown
/// rather than successful". A dropped connection ends the stream exactly like
/// this, and the run may well still be going server-side.
#[tokio::test(start_paused = true)]
async fn a_stream_that_ends_without_a_result_fails_the_turn_when_polling_cannot_answer() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Assistant {
            text: "half an ans".to_owned(),
        })
        .expect("stream open");
    drop(events); // connection dropped mid-run; polls all error too

    assert!(
        matches!(
            service.prompt(&session, "hi").await,
            Err(SessionError::Cursor(_))
        ),
        "a truncated stream must not report EndTurn"
    );
    // What did arrive was still delivered - the turn failed, the text was real.
    assert_eq!(notifier.updates().len(), 1);
}

/// A stream that dies after delivering text is finished by the poll - and
/// the answer the client already saw is not delivered twice.
#[tokio::test(start_paused = true)]
async fn a_truncated_stream_is_finished_by_the_poll_without_repeating_text() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Assistant {
            text: "the whole answer".to_owned(),
        })
        .expect("stream open");
    drop(events); // connection dropped after the text but before the result
    // First poll: still running; second: finished, repeating the text the
    // stream already delivered.
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Running,
        text: None,
    });
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("the whole answer".to_owned()),
    });

    let stop = service
        .prompt(&session, "hi")
        .await
        .expect("the poll finishes the turn");
    assert_eq!(stop, StopReason::EndTurn);
    // Exactly the one live delivery: the polled result must not repeat it.
    let text_updates = notifier
        .updates()
        .iter()
        .filter(|(_, update)| matches!(update, SessionUpdate::AgentMessageChunk { .. }))
        .count();
    assert_eq!(text_updates, 1);
}

/// A cancelled run reports `Cancelled` even though it has no `turn-ended`.
///
/// Recorded from a real cancel: `fixtures/real/cancelled.sse` carries
/// `result` and `done` but no `turn-ended`, so the terminal signal has to be
/// the result, not the envelope's end-of-turn marker.
#[tokio::test]
async fn a_cancelled_run_reports_cancelled_from_its_result() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Result {
            run_id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Cancelled,
            text: None,
            duration_ms: Some(1),
        })
        .expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    assert_eq!(
        service
            .prompt(&session, "hi")
            .await
            .expect("prompt answers"),
        StopReason::Cancelled
    );
}

/// MCP servers named at `session/new` reach agent creation.
///
/// Cursor configures MCP when the agent is created, so this is the only
/// moment they can be applied — a follow-up run cannot add them.
#[tokio::test]
async fn session_mcp_servers_reach_agent_creation() {
    let (service, cursor, _notifier) = service(None);
    let servers = vec![McpServer {
        name: "docs".to_owned(),
        transport: McpTransport::Http,
        url: "https://mcp.example.com".to_owned(),
        headers: vec![McpHeader {
            name: "Authorization".to_owned(),
            value: "Bearer t".to_owned(),
        }],
    }];
    let session = service.new_session(Path::new(""), servers.clone());

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "go").await.expect("prompt runs");

    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CreateAgent("go".to_owned(), None, servers)]
    );
}

/// A session with no MCP servers creates an agent with none — not with an
/// empty-but-present configuration that could override Cursor's own.
#[tokio::test]
async fn a_session_without_mcp_servers_forwards_none() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "go").await.expect("prompt runs");

    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CreateAgent("go".to_owned(), None, Vec::new())]
    );
}

/// A restored session's first prompt is a follow-up run on the restored
/// agent, not a fresh agent — that is the whole point of restoring.
#[tokio::test]
async fn a_restored_session_prompts_its_existing_agent() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(
        AcpSessionId::new("cursor-acp-7"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        Vec::new(),
    );
    assert!(service.has_session(&AcpSessionId::new("cursor-acp-7")));

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    service
        .prompt(&AcpSessionId::new("cursor-acp-7"), "continue")
        .await
        .expect("prompt runs");
    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CreateRun(
            CursorAgentId::new("bc-restored"),
            "continue".to_owned()
        )]
    );
}

/// Fresh ids skip over restored ones instead of replacing a live session.
#[tokio::test]
async fn new_sessions_never_collide_with_restored_ids() {
    let (service, _cursor, _notifier) = service(None);
    service.restore_session(
        AcpSessionId::new("cursor-acp-1"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        Vec::new(),
    );

    let fresh = service.new_session(Path::new("/workspace"), Vec::new());
    assert_ne!(fresh, AcpSessionId::new("cursor-acp-1"));
    assert!(service.has_session(&AcpSessionId::new("cursor-acp-1")));
    assert!(service.has_session(&fresh));
}

/// A session that died after `session/new` but before its first prompt is
/// restored with no agent — and the next prompt mints one, exactly like a
/// fresh session's first prompt. Seen live: a restart in that window left a
/// session every follow-up crashed against.
#[tokio::test]
async fn a_session_restored_without_an_agent_mints_one_on_the_next_prompt() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(AcpSessionId::new("cursor-acp-9"), None, None, Vec::new());
    assert!(service.has_session(&AcpSessionId::new("cursor-acp-9")));

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    service
        .prompt(&AcpSessionId::new("cursor-acp-9"), "hello again")
        .await
        .expect("prompt runs");
    assert!(matches!(
        cursor.calls().first(),
        Some(CursorCall::CreateAgent(..))
    ));
}
