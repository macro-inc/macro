use chrono::{TimeZone, Utc};

use agent_monitor::domain::model::{
    Agent, AgentId, AgentKind, Severity, Snapshot, Status, TapeEvent, TapeKind, Timestamp,
    TranscriptItem, TranscriptItemKind, Update, UpdateKind,
};

use super::*;
use crate::body::Vitals;

fn at(second: u32) -> Timestamp {
    Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, second)
        .single()
        .expect("a valid fixed time")
}

fn agent(id: &str, status: Status, active: u32) -> Agent {
    let mut agent = Agent::new(
        AgentId::from_wire(id.to_owned()),
        AgentKind::Builder,
        id.to_owned(),
    );
    agent.status = status;
    agent.last_activity = Some(at(active));
    agent
}

fn event(seq: u64, id: &str, kind: TapeKind, severity: Severity) -> TapeEvent {
    TapeEvent {
        seq,
        at: at(u32::try_from(seq).expect("small seq")),
        agent: AgentId::from_wire(id.to_owned()),
        kind,
        text: String::from("Bash cargo test"),
        severity,
    }
}

fn view() -> ViewState {
    ViewState::new(Box::new(Vitals::default()))
}

fn snapshot(seq: u64, agents: Vec<Agent>) -> Update {
    Update {
        seq,
        kind: UpdateKind::Snapshot(Snapshot {
            agents,
            ..Snapshot::default()
        }),
    }
}

#[test]
fn snapshot_replaces_and_older_updates_are_dropped() {
    let mut view = view();
    view.apply(Update {
        seq: 3,
        kind: UpdateKind::Upsert(agent("demo:old", Status::Idle, 0)),
    });
    view.apply(snapshot(10, vec![agent("demo:a", Status::Working, 1)]));

    assert_eq!(view.link, Link::Live);
    assert_eq!(view.seq, 10);
    assert_eq!(
        view.agents.keys().map(AgentId::as_str).collect::<Vec<_>>(),
        vec!["demo:a"]
    );

    // An update the snapshot already includes does not rewind it.
    view.apply(Update {
        seq: 9,
        kind: UpdateKind::Removed(AgentId::from_wire(String::from("demo:a"))),
    });
    assert!(view.agents.contains_key(&AgentId::from_wire(String::from("demo:a"))));

    view.apply(Update {
        seq: 11,
        kind: UpdateKind::Removed(AgentId::from_wire(String::from("demo:a"))),
    });
    assert!(view.agents.is_empty());
    assert_eq!(view.seq, 11);
}

#[test]
fn a_heartbeat_does_not_dirty_the_view() {
    let mut view = view();
    view.apply(snapshot(1, Vec::new()));
    view.dirty = false;

    view.apply(Update {
        seq: 2,
        kind: UpdateKind::Heartbeat(at(5)),
    });
    assert!(!view.dirty);
    assert_eq!(view.heartbeat, Some(at(5)));

    view.apply(Update {
        seq: 3,
        kind: UpdateKind::Event(event(3, "demo:a", TapeKind::ToolStart, Severity::Info)),
    });
    assert!(view.dirty);
    assert_eq!(view.tape.len(), 1);
}

#[test]
fn agents_sort_by_status_then_latest_activity() {
    let mut view = view();
    view.apply(snapshot(
        1,
        vec![
            agent("demo:idle", Status::Idle, 9),
            agent("demo:old-work", Status::Working, 1),
            agent("demo:new-work", Status::Working, 8),
            agent("demo:wait", Status::Waiting, 7),
            agent("demo:blocked", Status::Blocked, 2),
        ],
    ));
    let order: Vec<&str> = view
        .sorted_agents(&Filter::default())
        .iter()
        .map(|agent| agent.id.as_str())
        .collect();
    assert_eq!(
        order,
        vec![
            "demo:new-work",
            "demo:old-work",
            "demo:blocked",
            "demo:wait",
            "demo:idle"
        ]
    );
}

#[test]
fn filter_words_match_kind_status_and_name() {
    let mut view = view();
    let mut manager = agent("demo:lead", Status::Working, 1);
    manager.kind = AgentKind::Manager;
    view.apply(snapshot(
        1,
        vec![
            manager,
            agent("demo:rpc", Status::Working, 2),
            agent("demo:ui", Status::Idle, 3),
        ],
    ));

    let ids = |filter: Filter| -> Vec<String> {
        view.sorted_agents(&filter)
            .iter()
            .map(|agent| agent.id.to_string())
            .collect()
    };
    let words = |words: &[&str]| Filter {
        words: words.iter().map(|word| (*word).to_owned()).collect(),
        find: String::new(),
    };

    assert_eq!(ids(words(&["builder", "working"])), vec!["demo:rpc"]);
    assert_eq!(ids(words(&["manager"])), vec!["demo:lead"]);
    assert_eq!(
        ids(Filter {
            words: Vec::new(),
            find: String::from("u"),
        }),
        vec!["demo:ui"]
    );
}

#[test]
fn failures_are_newest_first_and_include_failed_agents_without_a_line() {
    let mut view = view();
    let mut failed = agent("demo:crashed", Status::Failed, 4);
    failed.status_detail = Some(String::from("exit 1"));
    view.apply(snapshot(1, vec![failed, agent("demo:rpc", Status::Working, 2)]));
    view.apply(Update {
        seq: 2,
        kind: UpdateKind::Event(event(2, "demo:rpc", TapeKind::ToolError, Severity::Warning)),
    });
    view.apply(Update {
        seq: 6,
        kind: UpdateKind::Event(event(6, "demo:rpc", TapeKind::ToolStart, Severity::Info)),
    });

    let rows: Vec<(&str, &str, String)> = view
        .failures(&Filter::default())
        .iter()
        .map(|row| (row.what, row.agent.as_str(), row.detail.clone()))
        .map(|(what, id, detail)| (what, if id == "demo:rpc" { "demo:rpc" } else { "demo:crashed" }, detail))
        .collect();
    assert_eq!(
        rows,
        vec![
            ("agent", "demo:crashed", String::from("exit 1")),
            ("tool", "demo:rpc", String::from("Bash cargo test")),
        ]
    );
}

#[test]
fn transcript_items_for_another_agent_are_ignored() {
    let mut view = view();
    let open = AgentId::from_wire(String::from("demo:a"));
    let other = AgentId::from_wire(String::from("demo:b"));
    view.open_transcript(open.clone());

    let item = TranscriptItem {
        at: at(1),
        kind: TranscriptItemKind::ToolCall,
        text: String::from("cargo test"),
        tool_id: Some(String::from("t1")),
        tool_name: Some(String::from("Bash")),
        is_error: false,
        duration_ms: None,
    };
    view.transcript_item(&other, item.clone());
    view.transcript_item(&open, item);

    let transcript = view.transcript.as_ref().expect("a transcript is open");
    assert_eq!(transcript.agent, open);
    assert_eq!(transcript.items.len(), 1);
}
