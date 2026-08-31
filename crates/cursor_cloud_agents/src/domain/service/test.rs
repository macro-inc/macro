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

fn cancelled(run: &str) -> CursorEvent {
    CursorEvent::Result {
        run_id: CursorRunId::new(run),
        status: RunStatus::Cancelled,
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
/// mirrored before the next prompt's output — full fidelity, oldest first:
/// the stream replay carries the cursor.com user's prompt (quoted) and the
/// agent's answer, so the client's view keeps up with the conversation its
/// prompt is about to continue.
#[tokio::test]
async fn foreign_runs_are_mirrored_before_the_next_prompt() {
    let (service, cursor, notifier) = service(None);
    let session = service.new_session(Path::new(""), Vec::new());
    let events = cursor.script_stream();
    events.send(finished("run-fake-1")).expect("stream open");
    events.send(CursorEvent::Done).expect("stream open");
    service.prompt(&session, "first").await.expect("first turn");

    // One cursor.com run happened since run-fake-1. The page also contains
    // the run this prompt itself is about to create — which must not be
    // mirrored, its own turn delivers it.
    cursor.script_run_listings(vec![
        RunListing {
            id: CursorRunId::new("run-fake-2"),
            status: RunStatus::Running,
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
    // The streams `prompt("second")` consumes, in order: the mirror of the
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
    // The mirrored prompt (quoted, attributed), its answer, then the turn's.
    assert!(
        texts[0].contains("asked on cursor.com") && texts[0].contains("> but like what is macro"),
        "got {texts:?}"
    );
    assert_eq!(texts[1], "a team workspace", "got {texts:?}");
    assert_eq!(texts[2], "own answer", "got {texts:?}");
}

/// The host's poll: cursor.com activity mirrors into a session within a
/// tick, without any Macro prompt — and mirrors exactly once.
#[tokio::test]
async fn sync_mirrors_foreign_runs_once() {
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
        .send(CursorEvent::Assistant {
            text: "from over there".to_owned(),
        })
        .expect("stream open");
    foreign
        .send(finished("run-foreign-1"))
        .expect("stream open");
    foreign.send(CursorEvent::Done).expect("stream open");

    service.sync_foreign_runs().await;
    let after_first = notifier.updates().len();
    assert!(after_first > before, "the foreign run must be delivered");

    // The watermark moved: the same listing mirrors nothing more.
    service.sync_foreign_runs().await;
    assert_eq!(notifier.updates().len(), after_first);
}

/// A foreign run whose stream is gone (retention expired) still delivers its
/// recorded final text rather than vanishing.
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

    service.sync_foreign_runs().await;
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
    assert!(
        texts
            .iter()
            .any(|text| text.contains("answered on cursor.com") && text.contains("the old answer")),
        "got {texts:?}"
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
