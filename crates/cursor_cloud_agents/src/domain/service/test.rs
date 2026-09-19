use super::*;
use crate::domain::error::SessionError;
use crate::domain::event::{CursorEvent, InteractionUpdate, ToolCallEvent, Truncation};
use crate::domain::model::{
    McpHeader, McpServer, McpTransport, RepoUrl, RunListing, RunOutcome, RunStatus,
};
use crate::testing::{CursorCall, FakeCursor, FixedRepos, RecordingNotifier};
use agent_client_protocol::schema::v1::{SessionUpdate, StopReason, ToolCallStatus};
use std::path::Path;

type Service = CursorSessionService<FakeCursor, RecordingNotifier, FixedRepos>;

fn service(repo: Option<RepoUrl>) -> (Arc<Service>, FakeCursor, RecordingNotifier) {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = Arc::new(CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(repo),
        Arc::new(crate::outbound::memory_journal::MemoryJournal::default()),
    ));
    (service, cursor, notifier)
}

/// Agent text chunks, in delivery order.
fn agent_texts(updates: &[(SessionId, SessionUpdate)]) -> Vec<String> {
    updates
        .iter()
        .filter_map(|(_, update)| match update {
            SessionUpdate::AgentMessageChunk(chunk) => match &chunk.content {
                ContentBlock::Text(text) => Some(text.text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

/// User text chunks, in delivery order.
fn user_texts(updates: &[(SessionId, SessionUpdate)]) -> Vec<String> {
    updates
        .iter()
        .filter_map(|(_, update)| match update {
            SessionUpdate::UserMessageChunk(chunk) => match &chunk.content {
                ContentBlock::Text(text) => Some(text.text.clone()),
                _ => None,
            },
            _ => None,
        })
        .collect()
}

fn ready_for_sync(service: &Service, id: &SessionId) -> bool {
    service
        .session(id)
        .expect("session exists")
        .state
        .lock()
        .expect("state poisoned")
        .ready_for_sync
}

/// The session's run-delivery watermark.
fn last_run(service: &Service, id: &SessionId) -> Option<CursorRunId> {
    service
        .session(id)
        .expect("session exists")
        .state
        .lock()
        .expect("state poisoned")
        .last_run
        .clone()
}

/// The client's standard load that a reload requirement asks for: the only
/// path recovered history reaches the client through. Returns what it showed.
async fn load(
    service: &Service,
    id: &SessionId,
    notifier: &RecordingNotifier,
) -> Vec<(SessionId, SessionUpdate)> {
    let before = notifier.updates().len();
    service.replay_session(id).await.expect("load").complete();
    assert!(
        ready_for_sync(service, id),
        "a successful load re-enables sync"
    );
    notifier.updates()[before..].to_vec()
}

fn finished(run: &str) -> CursorEvent {
    CursorEvent::Result {
        run_id: CursorRunId::new(run),
        status: RunStatus::Finished,
        text: None,
        duration_ms: Some(1),
    }
}

fn cancelled(run: &str) -> CursorEvent {
    CursorEvent::Result {
        run_id: CursorRunId::new(run),
        status: RunStatus::Cancelled,
        text: None,
        duration_ms: Some(1),
    }
}

#[tokio::test]
async fn active_turn_is_reported_while_cursor_is_working() {
    let (service, _cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let stored = service.session(&session).expect("session exists");
    let turn = stored.turn_gate.lock().await;
    assert!(service.has_active_turn());

    drop(turn);
    assert!(!service.has_active_turn());
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
            Vec::new(),
            None
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
    notifier.wait_for_updates(1).await;

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

/// A stop must not lose an answer the run had already produced.
///
/// The race: the run finishes, its stream is truncated before the `result`
/// frame, and the stop lands. Get A Run is the only place that answer exists,
/// so the poll reads it and delivers its text — a stopped turn ends on the
/// record it can reach, not on the token alone.
#[tokio::test(start_paused = true)]
async fn a_stop_still_delivers_a_finished_run_the_stream_never_reported() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });

    events
        .send(CursorEvent::Thinking {
            text: "hmm".to_owned(),
        })
        .expect("stream open");
    notifier.wait_for_updates(1).await;

    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("here is the answer".to_owned()),
    });
    service.cancel(&session).await.expect("cancel works");
    drop(events);

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
    let texts: Vec<String> = notifier
        .updates()
        .iter()
        .filter_map(|(_, update)| match update {
            SessionUpdate::AgentMessageChunk(chunk) => match &chunk.content {
                agent_client_protocol::schema::v1::ContentBlock::Text(text) => {
                    Some(text.text.clone())
                }
                _ => None,
            },
            _ => None,
        })
        .collect();
    assert_eq!(texts, vec!["here is the answer".to_owned()]);
}

/// Cancel is a notification: POST it, keep reading until Cursor's `result`.
///
/// Chunks that land after the POST are still the run — the Cloud Agents stream
/// is scoped to that run through `result` then `done`. Dropping the stream at
/// the POST used to resolve the ACP prompt while Cursor was still emitting.
#[tokio::test]
async fn cancel_keeps_reading_until_the_result_frame() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });

    events
        .send(CursorEvent::Assistant {
            text: "working".to_owned(),
        })
        .expect("stream open");
    notifier.wait_for_updates(1).await;

    assert!(!events.is_closed());
    service.cancel(&session).await.expect("cancel works");
    assert!(
        cursor
            .calls()
            .iter()
            .any(|call| matches!(call, CursorCall::CancelRun(..)))
    );

    events
        .send(CursorEvent::Assistant {
            text: " winding down".to_owned(),
        })
        .expect("stream still open after cancel");
    notifier.wait_for_updates(2).await;

    events.send(cancelled("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
    assert_eq!(notifier.updates().len(), 2);
}

/// A cancelled `result` does not always complete in-flight tool calls, so the
/// turn must fail them locally when that frame arrives — otherwise they stay
/// "running" in the transcript forever.
#[tokio::test]
async fn cancel_mid_tool_call_closes_it_as_failed() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });

    events
        .send(CursorEvent::ToolCall(ToolCallEvent {
            call_id: "call-1".to_owned(),
            name: "run_terminal_cmd".to_owned(),
            status: Some("running".to_owned()),
            args: None,
            result: None,
            truncated: Truncation::default(),
        }))
        .expect("stream open");
    notifier.wait_for_updates(1).await;

    service.cancel(&session).await.expect("cancel works");
    events.send(cancelled("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);

    let closing = notifier
        .updates()
        .into_iter()
        .rev()
        .find_map(|(_, update)| match update {
            SessionUpdate::ToolCallUpdate(update) if &*update.tool_call_id.0 == "call-1" => {
                Some(update)
            }
            _ => None,
        })
        .expect("the open call was closed out");
    assert_eq!(closing.fields.status, Some(ToolCallStatus::Failed));
}

/// A cancel while the prompt is still queued behind someone else's run ends
/// the wait, rather than sitting out the full busy timeout — and reports it as
/// the stop it is. The wait itself fails, but a failure the client asked for
/// is a stop reason: an ACP error would surface in the transcript as a red
/// "the prompt was cancelled while waiting for the agent to be free" instead
/// of a stopped turn.
#[tokio::test]
async fn cancel_ends_a_prompt_waiting_on_a_busy_agent() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    // First turn mints the agent, so the second takes the follow-up path.
    let events = cursor.script_stream();
    events.send(finished("run-1")).expect("stream open");
    drop(events);
    service.prompt(&session, "first").await.expect("first turn");

    // Busy for longer than the test will take, so the wait is what ends it.
    cursor.script_create_run_errors(8, "409 Conflict: {\"error\":{\"code\":\"agent_busy\"}}");
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "second").await }
    });
    cursor
        .wait_for_calls(1, |call| matches!(call, CursorCall::CreateRun(..)))
        .await;

    service.cancel(&session).await.expect("cancel works");

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
    // Nothing was ever created, so there is no run to have cancelled.
    assert!(
        !cursor
            .calls()
            .iter()
            .any(|call| matches!(call, CursorCall::CancelRun(..)))
    );
}

/// A stop while the fallback poll is running.
///
/// The poll only exists because the stream is gone, so a stop ends it at the
/// first wait rather than re-reading a record nobody is waiting on: one read,
/// then the turn is over.
#[tokio::test(start_paused = true)]
async fn a_stop_ends_the_fallback_poll_at_its_first_wait() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    // Plenty scripted, so what ends the poll is the stop and not the script.
    for _ in 0..10 {
        cursor.script_run_result(RunOutcome {
            status: RunStatus::Running,
            text: None,
        });
    }

    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });
    events
        .send(CursorEvent::Thinking {
            text: "hmm".to_owned(),
        })
        .expect("stream open");
    notifier.wait_for_updates(1).await;

    service.cancel(&session).await.expect("cancel works");
    drop(events); // no result frame, so the turn falls back to polling

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
    let polls = cursor
        .calls()
        .iter()
        .filter(|call| matches!(call, CursorCall::RunResult(..)))
        .count();
    assert_eq!(polls, 1, "one read of the record, then the stop ends it");
    assert!(
        service
            .session(&session)
            .unwrap()
            .state
            .lock()
            .unwrap()
            .last_run
            .is_none(),
        "local stop does not advance delivered watermark without reconciliation"
    );
}

/// A stop that beats the run into existence.
///
/// `cancel` has no run id to POST while the first prompt is still creating the
/// agent — ten seconds, live — so the stop is sent the moment the run has one.
/// Left unsent, Cursor keeps working and this turn reads the stream to the
/// agent's own natural end, which is the stop button doing nothing at all.
#[tokio::test]
async fn a_stop_before_the_run_exists_is_sent_once_it_does() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let finish_creating = cursor.script_create_gate();
    let events = cursor.script_stream();
    let turn = tokio::spawn({
        let service = Arc::clone(&service);
        let session = session.clone();
        async move { service.prompt(&session, "long job").await }
    });

    // Mid-create: the turn has neither agent nor run for a cancel to name.
    cursor
        .wait_for_calls(1, |call| matches!(call, CursorCall::CreateAgent(..)))
        .await;
    service.cancel(&session).await.expect("cancel works");
    assert!(
        !cursor
            .calls()
            .iter()
            .any(|call| matches!(call, CursorCall::CancelRun(..))),
        "there was no run to cancel yet"
    );

    finish_creating.send(()).expect("the create is waiting");

    // The run exists now, so the stop it missed is sent for it, and the turn
    // ends on Cursor's cancelled result like any other cancelled run.
    cursor
        .wait_for_calls(1, |call| matches!(call, CursorCall::CancelRun(..)))
        .await;
    events.send(cancelled("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = turn.await.expect("task joins").expect("prompt resolves");
    assert_eq!(stop, StopReason::Cancelled);
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
    let missing = SessionId::new("nope");
    assert!(matches!(
        service.prompt(&missing, "hi").await,
        Err(SessionError::UnknownSession(_))
    ));
    assert!(matches!(
        service.loaded(&missing),
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
        Err(SessionError::Journal(_))
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
        vec![CursorCall::CreateAgent(
            "go".to_owned(),
            None,
            servers,
            None
        )]
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
        vec![CursorCall::CreateAgent(
            "go".to_owned(),
            None,
            Vec::new(),
            None
        )]
    );
}

/// A restored session's first prompt is a follow-up run on the restored
/// agent, not a fresh agent — that is the whole point of restoring.
#[tokio::test]
async fn a_restored_session_prompts_its_existing_agent() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(
        SessionId::new("cursor-acp-7"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
    );
    crate::testing::script_legacy_history(&cursor);
    service
        .replay_session(&SessionId::new("cursor-acp-7"))
        .await
        .expect("full legacy history")
        .complete();
    assert!(service.has_session(&SessionId::new("cursor-acp-7")));

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    service
        .prompt(&SessionId::new("cursor-acp-7"), "continue")
        .await
        .expect("prompt runs");
    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CreateRun(
            CursorAgentId::new("bc-restored"),
            "continue".to_owned(),
            None
        )]
    );
}

/// A restored session has no in-memory `active_run` — this process never
/// drove the run itself — so cancelling it must fall back to asking Cursor
/// which run is current instead of silently skipping the remote cancel.
#[tokio::test]
async fn cancel_on_a_restored_session_finds_the_run_from_cursor() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(
        SessionId::new("cursor-acp-7"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
    );

    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-in-flight"),
            status: RunStatus::Running,
        },
        RunListing {
            id: CursorRunId::new("run-old"),
            status: RunStatus::Finished,
        },
    ]);

    service
        .cancel(&SessionId::new("cursor-acp-7"))
        .await
        .expect("cancel works");

    assert_eq!(
        cursor.calls(),
        vec![CursorCall::CancelRun(
            CursorAgentId::new("bc-restored"),
            CursorRunId::new("run-in-flight"),
        )]
    );
}

/// The fallback lookup cancels every run it finds in progress, not just the
/// first — Cursor documents one active run per agent, but that invariant is
/// not enforced client-side, and cancelling one leaked run is cheaper than
/// missing it.
#[tokio::test]
async fn cancel_on_a_restored_session_cancels_every_run_in_progress() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(
        SessionId::new("cursor-acp-10"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
    );

    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-creating"),
            status: RunStatus::Creating,
        },
        RunListing {
            id: CursorRunId::new("run-running"),
            status: RunStatus::Running,
        },
        RunListing {
            id: CursorRunId::new("run-old"),
            status: RunStatus::Finished,
        },
    ]);

    service
        .cancel(&SessionId::new("cursor-acp-10"))
        .await
        .expect("cancel works");

    assert_eq!(
        cursor.calls(),
        vec![
            CursorCall::CancelRun(
                CursorAgentId::new("bc-restored"),
                CursorRunId::new("run-creating"),
            ),
            CursorCall::CancelRun(
                CursorAgentId::new("bc-restored"),
                CursorRunId::new("run-running"),
            ),
        ]
    );
}

/// A restored session with no run currently going is a no-op, not an error —
/// the fallback lookup found nothing to cancel.
#[tokio::test]
async fn cancel_on_a_restored_session_with_no_run_going_is_a_no_op() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(
        SessionId::new("cursor-acp-8"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
    );

    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("run-old"),
        status: RunStatus::Finished,
    }]);

    service
        .cancel(&SessionId::new("cursor-acp-8"))
        .await
        .expect("cancel works");

    assert!(cursor.calls().is_empty());
}

/// Fresh ids skip over restored ones instead of replacing a live session.
#[tokio::test]
async fn new_sessions_never_collide_with_restored_ids() {
    let (service, _cursor, _notifier) = service(None);
    service.restore_session(
        SessionId::new("cursor-acp-1"),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
    );

    let fresh = service.new_session(Path::new("/workspace"), Vec::new());
    assert_ne!(fresh, SessionId::new("cursor-acp-1"));
    assert!(service.has_session(&SessionId::new("cursor-acp-1")));
    assert!(service.has_session(&fresh));
}

/// A session that died after `session/new` but before its first prompt is
/// restored with no agent — and the next prompt mints one, exactly like a
/// fresh session's first prompt. Seen live: a restart in that window left a
/// session every follow-up crashed against.
#[tokio::test]
async fn a_session_restored_without_an_agent_mints_one_on_the_next_prompt() {
    let (service, cursor, _notifier) = service(None);
    service.restore_session(SessionId::new("cursor-acp-9"), None, None, None);
    service
        .replay_session(&SessionId::new("cursor-acp-9"))
        .await
        .expect("empty session")
        .complete();
    assert!(service.has_session(&SessionId::new("cursor-acp-9")));

    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    service
        .prompt(&SessionId::new("cursor-acp-9"), "hello again")
        .await
        .expect("prompt runs");
    assert!(matches!(
        cursor.calls().first(),
        Some(CursorCall::CreateAgent(..))
    ));
}

/// A prompt that lands while another run is active (cursor.com drives the
/// same agent) waits it out instead of failing — the session is a queue.
#[tokio::test(start_paused = true)]
async fn a_prompt_waits_out_a_busy_agent() {
    let (service, cursor, _notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    // First turn establishes the agent.
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");

    // The follow-up gets agent_busy twice before the agent frees up.
    cursor.script_create_run_errors(2, "409 Conflict: {\"error\":{\"code\":\"agent_busy\"}}");
    let events = cursor.script_stream();
    events.send(finished("run-fake-2")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");

    let stop = service
        .prompt(&session, "second")
        .await
        .expect("the prompt queues behind the busy agent");
    assert_eq!(stop, StopReason::EndTurn);
}

/// Runs driven from cursor.com since the session's own last turn are
/// captured into the journal before the next prompt executes, in full
/// fidelity, oldest first. They never stream live: the prompt's own turn is
/// all the client sees until the reload the recovery requires, after which
/// the standard load shows the cursor.com user's prompt and the agent's
/// answer ahead of the turn that was about to continue the conversation.
#[tokio::test]
async fn foreign_runs_are_captured_before_the_next_prompt_and_shown_by_its_reload() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");
    assert!(notifier.reloads().is_empty());

    // One cursor.com run happened since run-fake-1. The page also contains
    // the run this prompt itself is about to create — which must not be
    // recovered, its own turn delivers it.
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-foreign-1"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
        },
    ]);
    // The streams `prompt("second")` consumes, in order: the capture of the
    // foreign run, then the turn's own.
    let foreign = cursor.script_stream();
    foreign
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "but like what is macro".to_owned(),
        }))
        .expect("stream open");
    foreign
        .send(CursorEvent::Assistant {
            text: "a team workspace".to_owned(),
        })
        .expect("stream open");
    foreign
        .send(finished("run-foreign-1"))
        .expect("stream open");
    foreign.send(CursorEvent::Done).expect("stream open");
    let own = cursor.script_stream();
    own.send(CursorEvent::Assistant {
        text: "own answer".to_owned(),
    })
    .expect("stream open");
    own.send(finished("run-fake-2")).expect("stream open");
    own.send(CursorEvent::Done).expect("stream open");

    service
        .prompt(&session, "second")
        .await
        .expect("second turn");
    assert_eq!(
        agent_texts(&notifier.updates()),
        vec!["own answer"],
        "recovered history never streams live"
    );
    assert!(user_texts(&notifier.updates()).is_empty());
    // The prompt path reconciles before and after acceptance; the requirement
    // coalesces into one signal until the client loads.
    assert_eq!(notifier.reloads(), vec![session.clone()]);
    assert!(
        ready_for_sync(&service, &session),
        "the host owns the dispatch barrier; recovery does not close the session"
    );

    let loaded = load(&service, &session, &notifier).await;
    assert_eq!(
        user_texts(&loaded),
        vec!["first", "but like what is macro", "second"]
    );
    assert_eq!(agent_texts(&loaded), vec!["a team workspace", "own answer"]);

    // The load checkpointed the prompt's own run, which now heads Cursor's
    // listing: the next tick recovers nothing and requires no reload.
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-fake-2"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-foreign-1"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
        },
    ]);
    let shown = notifier.updates().len();
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), shown);
    assert_eq!(notifier.reloads().len(), 1);
    assert!(ready_for_sync(&service, &session));
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("later"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: last_run(&service, &session).unwrap(),
            status: RunStatus::Finished,
        },
    ]);
    let later = cursor.script_stream();
    later
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "later question".into(),
        }))
        .unwrap();
    later.send(finished("later")).unwrap();
    later.send(CursorEvent::Done).unwrap();
    service.sync_foreign_runs().await;
    assert_eq!(
        notifier.reloads().len(),
        2,
        "successful load re-arms recovery"
    );
    assert_eq!(notifier.updates().len(), shown);
    let reloaded = load(&service, &session, &notifier).await;
    assert_eq!(user_texts(&reloaded).last().unwrap(), "later question");
}

/// The host's poll: cursor.com activity is captured into a session within a
/// tick, without any Macro prompt — exactly once, and only ever shown through
/// the standard load the capture requires.
#[tokio::test]
async fn sync_captures_foreign_runs_once_and_requires_one_load_to_show_them() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");
    let before = notifier.updates().len();

    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-foreign-1"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
        },
    ]);
    let foreign = cursor.script_stream();
    foreign
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "asked over there".to_owned(),
        }))
        .expect("stream open");
    foreign
        .send(CursorEvent::Assistant {
            text: "from over there".to_owned(),
        })
        .expect("stream open");
    foreign
        .send(finished("run-foreign-1"))
        .expect("stream open");
    foreign.send(CursorEvent::Done).expect("stream open");

    service.sync_foreign_runs().await;
    assert_eq!(
        notifier.updates().len(),
        before,
        "recovered history never streams live"
    );
    assert_eq!(notifier.reloads(), vec![session.clone()]);
    assert!(
        ready_for_sync(&service, &session),
        "the host owns the dispatch barrier; recovery does not close the session"
    );
    // While the requirement is pending, background ticks skip the session
    // rather than signalling again.
    service.sync_foreign_runs().await;
    assert_eq!(notifier.reloads().len(), 1);
    assert_eq!(notifier.updates().len(), before);

    let loaded = load(&service, &session, &notifier).await;
    assert_eq!(user_texts(&loaded), vec!["first", "asked over there"]);
    assert_eq!(agent_texts(&loaded), vec!["from over there"]);

    // The load moved the watermark: the same listing recovers nothing more
    // and requires no further reload.
    let shown = notifier.updates().len();
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), shown);
    assert_eq!(notifier.reloads().len(), 1);
    assert!(ready_for_sync(&service, &session));
}

#[tokio::test]
async fn standalone_recovery_does_not_require_a_host_channel() {
    crate::inbound::acp::AcpNotifier::new()
        .require_reload(&SessionId::new("standalone"))
        .await
        .unwrap();
}

/// Restore seeds the durable watermark. The client's initial load hydrates the
/// legacy run the watermark covers; only a run Cursor finished after it is
/// recovered by sync — captured once, never streamed, then shown in provider
/// order by the load the recovery requires, after which the tick is idempotent.
#[tokio::test]
async fn restore_recovers_runs_after_the_durable_watermark_once() {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(None),
        Arc::new(crate::outbound::memory_journal::MemoryJournal::default()),
    );
    let session = SessionId::new("cursor-acp-restored");
    service.restore_session_with_watermark(
        session.clone(),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
        Some(CursorRunId::new("run-delivered")),
    );
    // The initial load hydrates the run this session delivered before the
    // restart, from the provider's complete stream.
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("run-delivered"),
        status: RunStatus::Finished,
    }]);
    let delivered = cursor.script_stream();
    delivered
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "earlier question".to_owned(),
        }))
        .expect("stream open");
    delivered
        .send(CursorEvent::Assistant {
            text: "earlier answer".to_owned(),
        })
        .expect("stream open");
    delivered
        .send(finished("run-delivered"))
        .expect("stream open");
    delivered.send(CursorEvent::Done).expect("stream open");
    let initial = load(&service, &session, &notifier).await;
    assert_eq!(user_texts(&initial), ["earlier question"]);
    assert_eq!(agent_texts(&initial), ["earlier answer"]);
    assert_eq!(
        last_run(&service, &session),
        Some(CursorRunId::new("run-delivered"))
    );

    // Then a run happens on cursor.com.
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-missed"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-delivered"),
            status: RunStatus::Finished,
        },
    ]);
    let missed = cursor.script_stream();
    missed
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "missed question".to_owned(),
        }))
        .expect("stream open");
    missed
        .send(CursorEvent::Assistant {
            text: "recovered answer".to_owned(),
        })
        .expect("stream open");
    missed.send(finished("run-missed")).expect("stream open");
    missed.send(CursorEvent::Done).expect("stream open");
    service.sync_foreign_runs().await;
    assert_eq!(
        notifier.updates().len(),
        initial.len(),
        "recovered history never streams live"
    );
    assert_eq!(notifier.reloads(), vec![session.clone()]);
    let captured = |run: &str| {
        service
            .session(&session)
            .expect("session exists")
            .state
            .lock()
            .expect("state poisoned")
            .journal_entries
            .iter()
            .filter(|e| e.run.as_ref() == Some(&CursorRunId::new(run)))
            .filter(|e| e.input == JournalInput::Reconciled)
            .count()
    };
    assert_eq!(captured("run-missed"), 1);
    assert_eq!(
        captured("run-delivered"),
        1,
        "the delivered run was hydrated by the load and is not recovered again"
    );

    let loaded = load(&service, &session, &notifier).await;
    assert_eq!(user_texts(&loaded), ["earlier question", "missed question"]);
    assert_eq!(agent_texts(&loaded), ["earlier answer", "recovered answer"]);
    assert_eq!(
        last_run(&service, &session),
        Some(CursorRunId::new("run-missed")),
        "the load checkpoints the newest reconciled run"
    );
    let shown = notifier.updates().len();
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), shown);
    assert_eq!(notifier.reloads().len(), 1);
}

/// Sessions created before run checkpoints existed have no durable watermark.
/// Their initial load hydrates every run Cursor lists, oldest first, and
/// checkpoints the newest — so nothing is missed and the first sync tick
/// afterwards recovers nothing.
#[tokio::test]
async fn restore_without_a_watermark_hydrates_every_run_on_load() {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(None),
        Arc::new(crate::outbound::memory_journal::MemoryJournal::default()),
    );
    let session = SessionId::new("cursor-acp-restored");
    service.restore_session_with_watermark(
        session.clone(),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
        None,
    );
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-latest"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-old"),
            status: RunStatus::Finished,
        },
    ]);
    for (run, question, answer) in [
        ("run-old", "old question", "old answer"),
        ("run-latest", "latest question", "latest answer"),
    ] {
        let stream = cursor.script_stream();
        stream
            .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
                text: question.to_owned(),
            }))
            .expect("stream open");
        stream
            .send(CursorEvent::Assistant {
                text: answer.to_owned(),
            })
            .expect("stream open");
        stream.send(finished(run)).expect("stream open");
        stream.send(CursorEvent::Done).expect("stream open");
    }

    let loaded = load(&service, &session, &notifier).await;
    assert_eq!(user_texts(&loaded), ["old question", "latest question"]);
    assert_eq!(agent_texts(&loaded), ["old answer", "latest answer"]);
    assert_eq!(
        last_run(&service, &session),
        Some(CursorRunId::new("run-latest")),
        "the load's checkpoint makes the next tick idempotent"
    );
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), loaded.len());
    assert!(notifier.reloads().is_empty());
}

/// The host cannot route session updates until `session/load` has rebound the
/// restored ACP id. A mirror tick before then must leave the durable checkpoint
/// untouched so the next tick can recover the run after load.
#[tokio::test]
async fn restore_waits_for_session_load_before_recovering_runs() {
    let cursor = FakeCursor::new();
    let notifier = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        notifier.clone(),
        FixedRepos(None),
        Arc::new(crate::outbound::memory_journal::MemoryJournal::default()),
    );
    let session = SessionId::new("cursor-acp-restored");
    service.restore_session_with_watermark(
        session.clone(),
        Some(CursorAgentId::new("bc-restored")),
        None,
        None,
        Some(CursorRunId::new("run-delivered")),
    );
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("run-missed"),
        status: RunStatus::Finished,
    }]);

    service.sync_foreign_runs().await;

    assert!(notifier.updates().is_empty());
    assert!(notifier.reloads().is_empty());
    assert!(
        service
            .session(&session)
            .expect("session exists")
            .state
            .lock()
            .expect("state poisoned")
            .journal_entries
            .is_empty()
    );
}

/// A foreign run whose stream is gone (retention expired) is captured from
/// its run record, so the recorded answer is durable. But the record carries
/// no original prompt: recovery must not ask the client to reload a history
/// it cannot project, and an explicit load must fail rather than invent one —
/// the client's prior view stays in place until a load succeeds.
#[tokio::test(start_paused = true)]
async fn an_expired_foreign_stream_falls_back_to_the_run_record() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");

    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-foreign-1"),
            status: RunStatus::Finished,
        },
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
        },
    ]);
    // No scripted stream: the mirror's stream attempt fails, and the run
    // record answers instead.
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("the old answer".to_owned()),
    });

    let before = notifier.updates().len();
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), before);
    assert!(
        notifier.reloads().is_empty(),
        "an unprojectable recovery requires no reload"
    );
    assert!(ready_for_sync(&service, &session));
    let foreign = CursorRunId::new("run-foreign-1");
    let continuation = cursor.script_stream();
    continuation.send(finished("run-fake-2")).unwrap();
    continuation.send(CursorEvent::Done).unwrap();
    service
        .prompt(&session, "continue without replacing history")
        .await
        .unwrap();
    assert!(notifier.reloads().is_empty());
    let entries = service.journal.read(&session).await.expect("journal");
    assert!(
        entries.iter().any(|e| e.run.as_ref() == Some(&foreign)
            && matches!(&e.input, JournalInput::Poll(raw) if raw.contains("the old answer"))),
        "the recorded answer is durable"
    );
    assert!(
        entries
            .iter()
            .any(|e| e.run.as_ref() == Some(&foreign) && e.input == JournalInput::Reconciled)
    );

    let error = service
        .replay_session(&session)
        .await
        .err()
        .expect("a run without its original prompt cannot replace history");
    assert!(
        error.to_string().contains("original prompt unavailable"),
        "{error}"
    );
    assert_eq!(
        notifier.updates().len(),
        before,
        "a failed load publishes nothing: the prior view is retained"
    );
    assert!(
        !ready_for_sync(&service, &session),
        "nothing syncs or prompts until a load succeeds"
    );
    assert_eq!(
        service.journal.read(&session).await.expect("journal"),
        entries,
        "the failed load discards nothing captured"
    );
}

/// A run that is still executing cannot become the watermark when its stream
/// is unavailable, and requires no reload yet: the next sync must retry it
/// after Cursor finishes.
#[tokio::test]
async fn a_running_foreign_run_is_not_checkpointed_after_stream_fallback() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let initial = cursor.script_stream();
    initial.send(finished("run-fake-1")).expect("stream open");
    initial.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");

    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-foreign-1"),
            status: RunStatus::Running,
        },
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Finished,
        },
    ]);
    // No stream is queued, so recovery falls back to this still-running record.
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Running,
        text: None,
    });

    service.sync_foreign_runs().await;

    assert_eq!(
        last_run(&service, &session),
        Some(CursorRunId::new("run-fake-1"))
    );
    assert!(notifier.reloads().is_empty());
    assert!(
        ready_for_sync(&service, &session),
        "an unreconciled run leaves the session open to the next tick"
    );
}

/// A stream that delivers the answer and then hangs open must not hold the
/// turn open with it — seen live: the terminal `result` arrived minutes
/// after the text, and the client showed "writing" long after the answer.
/// Once the run's record says terminal, the turn closes from the record.
#[tokio::test(start_paused = true)]
async fn a_quiet_stream_closes_the_turn_from_the_run_record() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());

    let events = cursor.script_stream();
    events
        .send(CursorEvent::Assistant {
            text: "the whole answer".to_owned(),
        })
        .expect("stream open");
    // The sender stays alive: the stream is open and silent, exactly the
    // observed hang. The record already knows the run finished.
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("the whole answer".to_owned()),
    });
    cursor.script_run_result(RunOutcome {
        status: RunStatus::Finished,
        text: Some("the whole answer".to_owned()),
    });

    let stop = service
        .prompt(&session, "hi")
        .await
        .expect("the turn closes despite the hanging stream");
    assert_eq!(stop, StopReason::EndTurn);
    drop(events);
    // The live text is not repeated by the record-based closure.
    let text_updates = notifier
        .updates()
        .iter()
        .filter(|(_, update)| matches!(update, SessionUpdate::AgentMessageChunk { .. }))
        .count();
    assert_eq!(text_updates, 1);
}

/// The same durable inputs restore every turn without any provider execution.
#[tokio::test]
async fn durable_multiturn_load_replays_full_history_and_supports_continuation() {
    use crate::outbound::memory_journal::MemoryJournal;
    let journal = Arc::new(MemoryJournal::default());
    let cursor = FakeCursor::new();
    let live = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        live.clone(),
        FixedRepos(None),
        journal.clone(),
    );
    let id = service.new_session(Path::new(""), vec![]);
    for (prompt, fixture) in [
        ("first prompt", "multi_turn_1.sse"),
        ("second prompt", "file_operations.sse"),
    ] {
        let tx = cursor.script_raw_stream();
        for event in crate::testing::fixture_records(fixture) {
            tx.send(event).unwrap();
        }
        drop(tx);
        service.prompt(&id, prompt).await.unwrap();
    }
    let entries = journal.read(&id).await.unwrap();
    assert!(
        entries.iter().all(
            |e| !matches!(e.input, JournalInput::Sse(ref r) if r.data.contains("sessionUpdate"))
        )
    );
    let before = cursor.calls();
    let replayed = RecordingNotifier::new();
    let restored = Arc::new(CursorSessionService::new(
        cursor.clone(),
        replayed.clone(),
        FixedRepos(None),
        journal.clone(),
    ));
    restored.restore_session(id.clone(), Some(CursorAgentId::new("bc-fake")), None, None);
    restored.replay_session(&id).await.unwrap().complete();
    let first = replayed.updates();
    let replay_without_users: Vec<_> = first
        .iter()
        .filter(|(_, u)| !matches!(u, SessionUpdate::UserMessageChunk(_)))
        .cloned()
        .collect();
    assert_eq!(replay_without_users, live.updates());
    assert_eq!(
        first
            .iter()
            .filter(|(_, u)| matches!(u, SessionUpdate::UserMessageChunk(_)))
            .count(),
        2
    );
    assert_eq!(
        cursor.calls(),
        before,
        "load must not execute provider work"
    );
    restored.replay_session(&id).await.unwrap().complete();
    assert_eq!(&replayed.updates()[first.len()..], first.as_slice());
    assert_eq!(
        journal.read(&id).await.unwrap(),
        entries,
        "load is a read, not recapture"
    );
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Assistant {
        text: "next".into(),
    })
    .unwrap();
    tx.send(finished("run-fake-3")).unwrap();
    tx.send(CursorEvent::Done).unwrap();
    restored.prompt(&id, "continue").await.unwrap();
    assert!(
        matches!(cursor.calls().last(), Some(CursorCall::CreateRun(_, prompt, _)) if prompt == "continue")
    );
}

#[derive(Debug, Default)]
struct FailingJournal {
    inner: crate::outbound::memory_journal::MemoryJournal,
    fail_sequence: std::sync::atomic::AtomicI64,
}
impl CursorJournal for FailingJournal {
    fn read<'a>(
        &'a self,
        id: &'a SessionId,
    ) -> futures::future::BoxFuture<'a, Result<Vec<JournalEntry>, rootcause::Report>> {
        self.inner.read(id)
    }
    fn append<'a>(
        &'a self,
        id: &'a SessionId,
        expected: i64,
        run: Option<&'a CursorRunId>,
        input: &'a JournalInput,
    ) -> futures::future::BoxFuture<'a, Result<JournalEntry, rootcause::Report>> {
        Box::pin(async move {
            if expected + 1 == self.fail_sequence.load(std::sync::atomic::Ordering::SeqCst) {
                return Err(rootcause::report!("injected durable append failure"));
            }
            self.inner.append(id, expected, run, input).await
        })
    }
}

#[tokio::test]
async fn append_failure_publishes_nothing_and_never_advances_delivery_or_retries_a_prompt() {
    let journal = Arc::new(FailingJournal::default());
    journal
        .fail_sequence
        .store(4, std::sync::atomic::Ordering::SeqCst);
    let cursor = FakeCursor::new();
    let output = RecordingNotifier::new();
    let service = CursorSessionService::new(
        cursor.clone(),
        output.clone(),
        FixedRepos(None),
        journal.clone(),
    );
    let id = service.new_session(Path::new(""), vec![]);
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Assistant {
        text: "must never escape".into(),
    })
    .unwrap();
    tx.send(finished("run-fake-1")).unwrap();
    assert!(matches!(
        service.prompt(&id, "go").await,
        Err(SessionError::Journal(_))
    ));
    assert!(output.updates().is_empty());
    assert!(
        service
            .session(&id)
            .unwrap()
            .state
            .lock()
            .unwrap()
            .last_run
            .is_none()
    );
    assert_eq!(journal.read(&id).await.unwrap().len(), 3);
    assert!(service.prompt(&id, "retry").await.is_err());
    assert_eq!(
        cursor.calls().len(),
        1,
        "no second remote execution after capture failure"
    );
}

#[tokio::test]
async fn partial_capture_reconnect_matches_the_prefix_without_duplicate_content() {
    let (service, cursor, notifier) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    {
        let _gate = session.turn_gate.lock().await;
        service.ensure_journal(&id, &session).await.unwrap();
        let run = CursorRunId::new("foreign");
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::Interaction(
                    InteractionUpdate::UserMessage {
                        text: "asked elsewhere".into(),
                    },
                ))),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "hel".into(),
                })),
                false,
            )
            .await
            .unwrap();
        let tx = cursor.script_stream();
        tx.send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "asked elsewhere".into(),
        }))
        .unwrap();
        tx.send(CursorEvent::Assistant { text: "hel".into() })
            .unwrap();
        tx.send(CursorEvent::Assistant { text: "lo".into() })
            .unwrap();
        tx.send(finished("foreign")).unwrap();
        tx.send(CursorEvent::Done).unwrap();
        service
            .ingest_run(
                &id,
                &session,
                &CursorAgentId::new("agent"),
                &run,
                &tokio_util::sync::CancellationToken::new(),
                IngestMode {
                    emit: true,
                    ..IngestMode::HYDRATE
                },
            )
            .await
            .unwrap();
    }
    assert!(
        matches!(&notifier.updates()[..], [(_, SessionUpdate::AgentMessageChunk(c))] if matches!(&c.content, ContentBlock::Text(t) if t.text == "lo"))
    );
    let entries = service.journal.read(&id).await.unwrap();
    assert_eq!(entries.iter().filter(|e| matches!(&e.input, JournalInput::Sse(r) if matches!(r.decode(), CursorEvent::Assistant { text } if text == "hel"))).count(), 1);
}

#[tokio::test]
async fn restored_agent_without_provider_history_cannot_commit_empty_replacement() {
    let (service, cursor, notifier) = service(None);
    let id = SessionId::new("restored");
    service.restore_session(id.clone(), Some(CursorAgentId::new("agent")), None, None);
    cursor.script_run_listings(vec![]);

    assert!(service.replay_session(&id).await.is_err());
    assert!(notifier.updates().is_empty());
    assert!(service.journal.read(&id).await.unwrap().is_empty());
    assert!(service.prompt(&id, "must not execute").await.is_err());
    assert!(cursor.calls().is_empty());
}

#[tokio::test]
async fn incomplete_legacy_hydration_emits_nothing_and_cannot_enable_sync() {
    let (service, cursor, notifier) = service(None);
    let id = SessionId::new("old");
    service.restore_session(id.clone(), Some(CursorAgentId::new("agent")), None, None);
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("run-old"),
        status: RunStatus::Finished,
    }]);
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Assistant {
        text: "answer without original prompt".into(),
    })
    .unwrap();
    tx.send(finished("run-old")).unwrap();
    tx.send(CursorEvent::Done).unwrap();
    drop(tx);
    assert!(service.replay_session(&id).await.is_err());
    assert!(notifier.updates().is_empty());
    assert!(!ready_for_sync(&service, &id));
    assert!(
        !service
            .journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|e| e.input == JournalInput::HistoryComplete)
    );
    assert!(service.prompt(&id, "must not execute").await.is_err());
    assert!(cursor.calls().is_empty());
}

#[tokio::test]
async fn load_guard_orders_continuation_after_the_queued_response() {
    let (service, cursor, _notifier) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let guard = service.replay_session(&id).await.unwrap();
    let tx = cursor.script_stream();
    tx.send(finished("run-fake-1")).unwrap();
    tx.send(CursorEvent::Done).unwrap();
    let next = tokio::spawn({
        let service = service.clone();
        let id = id.clone();
        async move { service.prompt(&id, "next").await }
    });
    tokio::task::yield_now().await;
    assert!(
        cursor.calls().is_empty(),
        "the load gate still owns emission"
    );
    guard.complete(); // the ACP adapter does this only after responder.respond
    next.await.unwrap().unwrap();
}

#[tokio::test]
async fn stream_unavailable_records_are_captured_before_retry() {
    let (service, cursor, _notifier) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let first = cursor.script_stream();
    first
        .send(CursorEvent::Error {
            code: Some("stream_unavailable".into()),
            message: "starting".into(),
        })
        .unwrap();
    let second = cursor.script_stream();
    second.send(finished("run-fake-1")).unwrap();
    second.send(CursorEvent::Done).unwrap();
    service.prompt(&id, "go").await.unwrap();
    assert!(service.journal.read(&id).await.unwrap().iter().any(|e| matches!(&e.input, JournalInput::Sse(r) if matches!(r.decode(), CursorEvent::Error { .. }))));
}

#[tokio::test]
async fn aborted_prompt_is_retained_in_load_history_without_remote_execution() {
    let (service, cursor, output) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    {
        let _gate = session.turn_gate.lock().await;
        service.ensure_journal(&id, &session).await.unwrap();
        service
            .capture(
                &id,
                &session,
                None,
                JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new(
                    "stopped before execution",
                ))]),
                false,
            )
            .await
            .unwrap();
        service
            .capture(&id, &session, None, JournalInput::PromptAborted(2), false)
            .await
            .unwrap();
    }
    service.replay_session(&id).await.unwrap().complete();
    assert!(
        matches!(&output.updates()[..], [(_, SessionUpdate::UserMessageChunk(c))] if matches!(&c.content, ContentBlock::Text(t) if t.text == "stopped before execution"))
    );
    assert!(cursor.calls().is_empty());
}

#[tokio::test]
async fn terminal_poll_crash_is_reconciled_without_reopening_or_duplicating_tools() {
    let (service, cursor, output) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    let run = CursorRunId::new("R");
    {
        let _gate = session.turn_gate.lock().await;
        service.ensure_journal(&id, &session).await.unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("go"))]),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "hel".into(),
                })),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::ToolCall(
                    ToolCallEvent {
                        call_id: "tool".into(),
                        name: "shell".into(),
                        args: None,
                        result: None,
                        status: None,
                        truncated: Truncation::default(),
                    },
                ))),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Poll(r#"{"status":"FINISHED","result":"hello"}"#.into()),
                false,
            )
            .await
            .unwrap();
    }
    // Crash before Reconciled: replay restores hello plus terminal tool cleanup.
    service.replay_session(&id).await.unwrap().complete();
    let replay = output.updates();
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Assistant { text: "hel".into() })
        .unwrap();
    tx.send(CursorEvent::Assistant { text: "lo".into() })
        .unwrap();
    tx.send(finished("R")).unwrap();
    cursor.script_run_listings(vec![RunListing {
        id: run.clone(),
        status: RunStatus::Finished,
    }]);
    session.state.lock().unwrap().agent = Some(CursorAgentId::new("agent"));
    service.sync_foreign_runs().await;
    assert_eq!(
        output.updates(),
        replay,
        "no duplicated lo or repeated tool cleanup"
    );
    assert!(
        service
            .journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|e| e.run.as_ref() == Some(&run) && e.input == JournalInput::Reconciled)
    );
    service.replay_session(&id).await.unwrap().complete();
    assert_eq!(&output.updates()[replay.len()..], replay.as_slice());
    assert!(
        cursor.calls().is_empty(),
        "terminal recovery requires no provider read/execution"
    );
}

#[tokio::test]
async fn capture_backlog_includes_the_run_at_the_delivered_watermark_after_restart() {
    let (service, cursor, output) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    let run = CursorRunId::new("cancelled-run");
    {
        let _gate = session.turn_gate.lock().await;
        service.ensure_journal(&id, &session).await.unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("go"))]),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "hel".into(),
                })),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Interrupted("disconnected cancellation".into()),
                false,
            )
            .await
            .unwrap();
    }
    service.restore_session_with_watermark(
        id.clone(),
        Some(CursorAgentId::new("agent")),
        None,
        None,
        Some(run.clone()),
    );
    service.replay_session(&id).await.unwrap().complete();
    let before = output.updates().len();
    cursor.script_run_listings(vec![RunListing {
        id: run.clone(),
        status: RunStatus::Finished,
    }]);
    let tx = cursor.script_stream();
    tx.send(CursorEvent::Assistant { text: "hel".into() })
        .unwrap();
    tx.send(CursorEvent::Assistant { text: "lo".into() })
        .unwrap();
    tx.send(finished("cancelled-run")).unwrap();
    tx.send(CursorEvent::Done).unwrap();
    service.sync_foreign_runs().await;
    assert_eq!(
        output.updates().len(),
        before,
        "the backlog is captured, not streamed"
    );
    assert_eq!(output.reloads(), vec![id.clone()]);
    assert!(
        service
            .journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|e| e.input == JournalInput::Reconciled)
    );
    let loaded = load(&service, &id, &output).await;
    assert_eq!(user_texts(&loaded), ["go"]);
    assert_eq!(
        agent_texts(&loaded),
        ["hel", "lo"],
        "the captured prefix is not repeated"
    );
}

#[tokio::test(start_paused = true)]
async fn a_newly_accepted_run_waits_behind_a_failed_older_backfill() {
    let (service, cursor, output) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    let session = service.session(&id).unwrap();
    session.state.lock().unwrap().agent = Some(CursorAgentId::new("agent"));
    let gate = cursor.script_create_gate();
    let task = tokio::spawn({
        let service = service.clone();
        let id = id.clone();
        async move { service.prompt(&id, "R2").await }
    });
    cursor
        .wait_for_calls(1, |c| matches!(c, CursorCall::CreateRun(..)))
        .await;
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-fake-1"),
            status: RunStatus::Running,
        },
        RunListing {
            id: CursorRunId::new("R1"),
            status: RunStatus::Finished,
        },
    ]);
    let opened = CursorEvent::ToolCall(ToolCallEvent {
        call_id: "R1-tool".into(),
        name: "shell".into(),
        args: None,
        result: None,
        status: None,
        truncated: Truncation::default(),
    });
    let partial = cursor.script_stream();
    partial
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "R1 prompt".into(),
        }))
        .unwrap();
    partial.send(opened.clone()).unwrap();
    partial
        .send(CursorEvent::Error {
            code: None,
            message: "transport interrupted".into(),
        })
        .unwrap();
    drop(partial);
    gate.send(()).unwrap();
    assert!(
        task.await.unwrap().is_err(),
        "failed R1 prevents R2 ingestion"
    );
    assert!(
        !output.updates().iter().any(|(_, u)| matches!(
            u,
            SessionUpdate::AgentMessageChunk(_) | SessionUpdate::ToolCallUpdate(_)
        )),
        "R2 cannot emit text or close R1's still-open tool"
    );
    let entries = service.journal.read(&id).await.unwrap();
    assert!(
        entries
            .iter()
            .any(|e| e.run.as_ref() == Some(&CursorRunId::new("run-fake-1"))
                && matches!(e.input, JournalInput::PromptAccepted(_))),
        "R2 acceptance remains recoverable"
    );
    let pending = fold::replay(service.journal.clone(), id.clone()).await;
    assert_eq!(
        pending.len(),
        2,
        "queued R2 must not steal the incomplete R1 turn during load"
    );
    assert_eq!(
        pending[0].parts.first(),
        Some(&agent_fold::domain::model::MessagePart::Text {
            text: "R1 prompt".into()
        })
    );
    assert!(pending[1].stop.is_none());
    for (run, text, user) in [("R1", "older", true), ("run-fake-1", "newer", false)] {
        let tx = cursor.script_stream();
        if user {
            tx.send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
                text: "R1 prompt".into(),
            }))
            .unwrap();
        }
        if user {
            tx.send(opened.clone()).unwrap();
            let mut completed = match opened.clone() {
                CursorEvent::ToolCall(call) => call,
                _ => unreachable!(),
            };
            completed.status = Some("completed".into());
            completed.result = Some(serde_json::json!("older tool finished"));
            tx.send(CursorEvent::ToolCall(completed)).unwrap();
        }
        tx.send(CursorEvent::Assistant { text: text.into() })
            .unwrap();
        tx.send(finished(run)).unwrap();
        tx.send(CursorEvent::Done).unwrap();
    }
    service.sync_foreign_runs().await;
    assert!(
        agent_texts(&output.updates()).is_empty(),
        "recovered runs are captured, never streamed"
    );
    assert_eq!(output.reloads(), vec![id.clone()]);
    let messages = fold::replay(service.journal.clone(), id.clone()).await;
    let text: Vec<_> = messages
        .iter()
        .map(|message| {
            message
                .parts
                .iter()
                .filter_map(|part| match part {
                    agent_fold::domain::model::MessagePart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("")
        })
        .collect();
    assert_eq!(text, ["R1 prompt", "older", "R2", "newer"]);
    assert_eq!(messages[0].id, messages[1].id);
    assert_eq!(messages[2].id, messages[3].id);
    assert_ne!(messages[0].id, messages[2].id);
    assert_eq!(
        messages[1].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
    assert_eq!(
        messages[3].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
}

#[tokio::test]
async fn model_resolution_precedes_intent_and_definite_rejection_aborts_it() {
    let cursor = FakeCursor::new();
    let journal = Arc::new(crate::outbound::memory_journal::MemoryJournal::default());
    let service = Arc::new(
        CursorSessionService::new(
            cursor.clone(),
            RecordingNotifier::new(),
            FixedRepos(None),
            journal.clone(),
        )
        .with_default_model(Some("model".into())),
    );
    let id = service.new_session(Path::new(""), vec![]);
    let gate = cursor.script_model_gate();
    cursor.script_rejection();
    let task = tokio::spawn({
        let service = service.clone();
        let id = id.clone();
        async move { service.prompt(&id, "rejected").await }
    });
    tokio::task::yield_now().await;
    assert!(
        journal.read(&id).await.unwrap().is_empty(),
        "no intent during model resolution"
    );
    gate.send(()).unwrap();
    assert!(task.await.unwrap().is_err());
    assert!(
        journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|e| matches!(e.input, JournalInput::PromptAborted(_)))
    );
    service.replay_session(&id).await.unwrap().complete();
}

mod fold;

#[tokio::test]
async fn cancellation_during_pre_prompt_recovery_never_executes_the_pending_prompt() {
    let (service, cursor, output) = service(None);
    let id = service.new_session(Path::new(""), vec![]);
    service.session(&id).unwrap().state.lock().unwrap().agent = Some(CursorAgentId::new("agent"));
    cursor.script_run_listings(vec![RunListing {
        id: CursorRunId::new("older"),
        status: RunStatus::Running,
    }]);
    let events = cursor.script_stream();
    let task = tokio::spawn({
        let service = service.clone();
        let id = id.clone();
        async move { service.prompt(&id, "must not execute").await }
    });
    events
        .send(CursorEvent::Interaction(InteractionUpdate::UserMessage {
            text: "old question".into(),
        }))
        .unwrap();
    loop {
        if service
            .journal
            .read(&id)
            .await
            .unwrap()
            .iter()
            .any(|entry| matches!(entry.input, JournalInput::Sse(_)))
        {
            break;
        }
        tokio::task::yield_now().await;
    }
    service.cancel(&id).await.unwrap();
    events
        .send(CursorEvent::Assistant {
            text: "old answer".into(),
        })
        .unwrap();
    events.send(finished("older")).unwrap();
    events.send(CursorEvent::Done).unwrap();
    assert_eq!(task.await.unwrap().unwrap(), StopReason::Cancelled);
    assert!(!cursor.calls().iter().any(|call| matches!(
        call,
        CursorCall::CreateAgent(..) | CursorCall::CreateRun(..)
    )));
    assert_eq!(output.reloads(), vec![id.clone()]);
    assert!(output.updates().is_empty());
    // The load shows the recovered older turn, then the aborted prompt as a
    // cancelled turn that never reached the provider.
    let messages = fold::replay(service.journal.clone(), id).await;
    let texts: Vec<String> = messages
        .iter()
        .map(|message| {
            message
                .parts
                .iter()
                .filter_map(|part| match part {
                    agent_fold::domain::model::MessagePart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect()
        })
        .collect();
    assert_eq!(
        texts,
        ["old question", "old answer", "must not execute", ""]
    );
    assert_eq!(messages[0].id, messages[1].id);
    assert_eq!(messages[2].id, messages[3].id);
    assert_eq!(
        messages[1].stop,
        Some(agent_fold::domain::model::StopReason::EndTurn)
    );
    assert_eq!(
        messages[3].stop,
        Some(agent_fold::domain::model::StopReason::Cancelled)
    );
}

#[tokio::test]
async fn actual_load_frames_restore_terminal_outcomes_and_leave_partial_tail_open() {
    use agent_fold::domain::model::StopReason as FoldStop;
    for (status, expected) in [
        (Some(RunStatus::Finished), Some(FoldStop::EndTurn)),
        (Some(RunStatus::Cancelled), Some(FoldStop::Cancelled)),
        (
            Some(RunStatus::Error),
            Some(FoldStop::Failed {
                message: "Agent run ended in Error".into(),
            }),
        ),
        (None, None),
    ] {
        let (service, _, _) = service(None);
        let id = service.new_session(Path::new(""), vec![]);
        let session = service.session(&id).unwrap();
        service.ensure_journal(&id, &session).await.unwrap();
        let run = CursorRunId::new("run");
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Prompt(vec![ContentBlock::Text(TextContent::new("question"))]),
                false,
            )
            .await
            .unwrap();
        service
            .capture(
                &id,
                &session,
                Some(&run),
                JournalInput::Sse(crate::testing::raw_record(CursorEvent::Assistant {
                    text: "answer".into(),
                })),
                false,
            )
            .await
            .unwrap();
        if let Some(status) = status {
            service
                .capture(
                    &id,
                    &session,
                    Some(&run),
                    JournalInput::Poll(
                        serde_json::json!({"status":status,"result":"answer"}).to_string(),
                    ),
                    false,
                )
                .await
                .unwrap();
        }
        let messages = fold::replay(service.journal.clone(), id.clone()).await;
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].id, messages[1].id);
        assert_eq!(messages[1].stop, expected);
        if expected.is_none() {
            let continued = fold::replay_with_tail(
                service.journal.clone(),
                id,
                Some(vec![
                    CursorEvent::Assistant {
                        text: "answer".into(),
                    },
                    CursorEvent::Assistant {
                        text: " continued".into(),
                    },
                    finished("run"),
                    CursorEvent::Done,
                ]),
            )
            .await;
            assert_eq!(continued.len(), 2);
            assert_eq!(continued[1].stop, Some(FoldStop::EndTurn));
            assert_eq!(
                continued[1].parts.first(),
                Some(&agent_fold::domain::model::MessagePart::Text {
                    text: "answer continued".into()
                })
            );
        }
    }
}
