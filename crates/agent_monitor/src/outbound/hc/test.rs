use std::os::unix::fs::PermissionsExt as _;
use std::path::{Path, PathBuf};

use chrono::DateTime;

use super::*;
use crate::domain::model::AgentKind;
use crate::domain::observation::{
    Fact, FactKey, FinishReason, TerminalActivity, TerminalFact, TerminalState,
};

const CAPTURE: &str = include_str!("../../../fixtures/hc_events.jsonl");

/// A stand-in `hc` that prints the capture and exits, like a feed that ends.
fn fake_hc(dir: &Path) -> PathBuf {
    let capture = dir.join("capture.jsonl");
    std::fs::write(&capture, CAPTURE).expect("write capture");
    let program = dir.join("hc");
    std::fs::write(
        &program,
        format!("#!/bin/sh\nexec cat '{}'\n", capture.display()),
    )
    .expect("write script");
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    program
}

fn labels() -> HcLabels {
    HcLabels {
        run_id: vec!["run.id".to_owned()],
    }
}

async fn run_capture() -> (Vec<Change>, Result<(), SourceError>) {
    let dir = tempfile::tempdir().expect("tempdir");
    let source = Box::new(HcSource::new(vec![fake_hc(dir.path())], labels()));
    let (out, mut observations) = mpsc::channel(64);

    let result = source.run(out, CancellationToken::new()).await;
    let mut changes = Vec::new();
    while let Ok(observation) = observations.try_recv() {
        assert_eq!(observation.source, SourceKind::Hc);
        changes.push(observation.change);
    }
    (changes, result)
}

fn terminal(change: &Change) -> &TerminalFact {
    match change {
        Change::Upsert(Fact::Terminal(terminal)) => terminal,
        other => panic!("expected a terminal upsert, got {other:?}"),
    }
}

fn reset(change: &Change) -> Vec<&TerminalFact> {
    match change {
        Change::Reset(facts) => facts
            .iter()
            .map(|fact| match fact {
                Fact::Terminal(terminal) => terminal.as_ref(),
                other => panic!("expected terminals, got {other:?}"),
            })
            .collect(),
        other => panic!("expected a reset, got {other:?}"),
    }
}

#[tokio::test]
async fn the_snapshot_becomes_a_reset_of_decoded_terminals() {
    let (changes, _) = run_capture().await;

    let terminals = reset(&changes[0]);
    assert_eq!(terminals.len(), 2);
    assert_eq!(
        *terminals[0],
        TerminalFact {
            address: "t1".to_owned(),
            name: "lead".to_owned(),
            parent: None,
            spawned_by: None,
            cwd: Some(PathBuf::from("/work/alpha")),
            state: TerminalState::Live,
            activity: Some(TerminalActivity::Working),
            status_message: Some("Running tests".to_owned()),
            turn: Some(3),
            created: DateTime::from_timestamp_millis(1_800_000_000_000),
            finished: None,
            exit_code: None,
            finish_reason: None,
            foreground_pid: Some(4001),
            program: Some("claude-code".to_owned()),
            kind: Some(AgentKind::Manager),
            model: Some("claude-opus-5-5".to_owned()),
            space: Some("sp1".to_owned()),
            goal: Some("Ship the widget".to_owned()),
            waiting: false,
            manager_dir: Some(PathBuf::from("/state/managers/t1-1")),
            macrod_session: None,
            run_id: Some("run-7".to_owned()),
            tags: vec!["alpha".to_owned(), "beta".to_owned()],
        }
    );

    // A terminal with no name and a shell in front is a named-by-address shell.
    assert_eq!(terminals[1].name, "t2");
    assert_eq!(terminals[1].kind, Some(AgentKind::Shell));
    assert_eq!(terminals[1].program.as_deref(), Some("bash"));

    match &changes[1] {
        Change::Health(health) => {
            assert_eq!(health.state, SourceState::Healthy);
            assert_eq!(health.items, 2);
        }
        other => panic!("expected health, got {other:?}"),
    }
}

#[tokio::test]
async fn events_patch_the_terminal_they_name() {
    let (changes, _) = run_capture().await;

    let created = terminal(&changes[2]);
    assert_eq!(created.address, "t3");
    assert_eq!(created.spawned_by.as_deref(), Some("t1"));
    assert_eq!(created.kind, Some(AgentKind::Builder));

    let foreground = terminal(&changes[3]);
    assert_eq!(foreground.foreground_pid, Some(4003));
    assert_eq!(foreground.program.as_deref(), Some("claude-code"));

    let status = terminal(&changes[4]);
    assert_eq!(status.activity, Some(TerminalActivity::Working));
    assert_eq!(status.status_message.as_deref(), Some("Editing"));

    // A turn event's `state` is the status, never live or finished.
    let turn = terminal(&changes[5]);
    assert_eq!(turn.address, "t1");
    assert_eq!(turn.turn, Some(4));
    assert_eq!(turn.activity, Some(TerminalActivity::Done));
    assert_eq!(turn.state, TerminalState::Live);

    let labelled = terminal(&changes[6]);
    assert!(labelled.waiting);

    // An event type this adapter does not know leaves the terminal as it was.
    assert_eq!(terminal(&changes[7]), labelled);

    let finished = terminal(&changes[8]);
    assert_eq!(finished.address, "t2");
    assert_eq!(finished.state, TerminalState::Finished);
    assert_eq!(finished.exit_code, Some(1));
    assert_eq!(finished.finish_reason, Some(FinishReason::Exited));

    assert_eq!(
        changes[9],
        Change::Remove(FactKey::Terminal("t2".to_owned()))
    );
}

#[tokio::test]
async fn missed_events_are_recovered_by_the_fresh_snapshot() {
    let (changes, result) = run_capture().await;

    let terminals = reset(&changes[10]);
    assert_eq!(terminals.len(), 1);
    assert_eq!(terminals[0].state, TerminalState::Finished);
    assert_eq!(terminals[0].finish_reason, Some(FinishReason::Killed));
    assert_eq!(changes.len(), 12);

    // The feed ending is an error, so the supervisor restarts it.
    assert!(matches!(result, Err(SourceError::Internal(_))));
}

#[tokio::test]
async fn an_event_for_an_unknown_terminal_restarts_the_feed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let capture = dir.path().join("capture.jsonl");
    std::fs::write(
        &capture,
        "{\"seq\":1,\"terminals\":[]}\n\
         {\"jsonrpc\":\"2.0\",\"method\":\"event\",\"params\":{\"data\":{\"turn\":1},\"seq\":2,\"terminal\":\"t9\",\"type\":\"turn\"}}\n",
    )
    .expect("write");
    let program = dir.path().join("hc");
    std::fs::write(
        &program,
        format!("#!/bin/sh\ncat '{}'\nexec sleep 30\n", capture.display()),
    )
    .expect("write script");
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let (out, _observations) = mpsc::channel(64);

    let result = Box::new(HcSource::new(vec![program], labels()))
        .run(out, CancellationToken::new())
        .await;

    let Err(SourceError::Internal(report)) = result else {
        panic!("expected a restart, got {result:?}");
    };
    assert!(
        format!("{report:?}").contains("UnknownTerminal"),
        "{report:?}"
    );
}

#[tokio::test]
async fn a_machine_without_hc_reports_the_source_absent_and_waits() {
    let (out, mut observations) = mpsc::channel(4);
    let cancel = CancellationToken::new();
    let source = Box::new(HcSource::new(
        vec![PathBuf::from("/nonexistent/hc")],
        HcLabels::default(),
    ));
    let task = tokio::spawn(source.run(out, cancel.clone()));

    let observation = observations.recv().await.expect("health");
    match observation.change {
        Change::Health(health) => assert_eq!(health.state, SourceState::Absent),
        other => panic!("expected health, got {other:?}"),
    }

    cancel.cancel();
    assert!(task.await.expect("joined").is_ok());
}

#[tokio::test]
async fn hc_is_found_at_a_later_candidate_when_the_first_is_missing() {
    let dir = tempfile::tempdir().expect("tempdir");
    let source = Box::new(HcSource::new(
        vec![PathBuf::from("/nonexistent/hc"), fake_hc(dir.path())],
        labels(),
    ));
    let (out, mut observations) = mpsc::channel(64);

    let _ = source.run(out, CancellationToken::new()).await;

    let first = observations.try_recv().expect("an observation");
    assert!(
        matches!(first.change, Change::Reset(_)),
        "the fallback's snapshot arrives first, not an absent report: {:?}",
        first.change
    );
}

#[tokio::test]
async fn a_heartbeat_between_missed_and_the_new_snapshot_keeps_the_feed() {
    let dir = tempfile::tempdir().expect("tempdir");
    let capture = dir.path().join("capture.jsonl");
    std::fs::write(
        &capture,
        "{\"seq\":1,\"terminals\":[]}\n\
         {\"jsonrpc\":\"2.0\",\"method\":\"missed\",\"params\":{\"seq\":2}}\n\
         {\"jsonrpc\":\"2.0\",\"method\":\"heartbeat\",\"params\":{\"seq\":3}}\n\
         {\"seq\":4,\"terminals\":[]}\n",
    )
    .expect("write");
    let program = dir.path().join("hc");
    std::fs::write(
        &program,
        format!("#!/bin/sh\nexec cat '{}'\n", capture.display()),
    )
    .expect("write script");
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).expect("chmod");
    let (out, mut observations) = mpsc::channel(64);

    let result = Box::new(HcSource::new(vec![program], labels()))
        .run(out, CancellationToken::new())
        .await;

    let mut resets = 0;
    while let Ok(observation) = observations.try_recv() {
        if matches!(observation.change, Change::Reset(_)) {
            resets += 1;
        }
    }
    assert_eq!(resets, 2, "both snapshots are applied");
    let Err(SourceError::Internal(report)) = result else {
        panic!("the feed ends only when the capture does, got {result:?}");
    };
    assert!(format!("{report:?}").contains("Exited"), "{report:?}");
}
