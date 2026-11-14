use chrono::{TimeDelta, TimeZone, Utc};

use agent_monitor::domain::model::{
    Agent, AgentId, AgentKind, CiState, Pr, PrState, Severity, Snapshot, Status, TapeEvent,
    TapeKind, Timestamp, TranscriptItem, TranscriptItemKind, Update, UpdateKind,
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

fn agent_at(id: &str, status: Status, active: Timestamp) -> Agent {
    let mut agent = agent(id, status, 0);
    agent.last_activity = Some(active);
    agent
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
    assert!(
        view.agents
            .contains_key(&AgentId::from_wire(String::from("demo:a")))
    );

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
        ..Filter::default()
    };

    assert_eq!(ids(words(&["builder", "working"])), vec!["demo:rpc"]);
    assert_eq!(ids(words(&["manager"])), vec!["demo:lead"]);
    assert_eq!(
        ids(Filter {
            find: String::from("u"),
            ..Filter::default()
        }),
        vec!["demo:ui"]
    );
}

#[test]
fn failures_add_up_to_failed_agents_and_every_tool_error() {
    let mut view = view();
    let mut failed = agent("demo:crashed", Status::Failed, 4);
    failed.status_detail = Some(String::from("exit 1"));
    // Three tool errors, of which only one is still on the tape.
    let mut rpc = agent("demo:rpc", Status::Working, 2);
    rpc.tool_errors = 3;
    rpc.started = Some(at(1));
    view.apply(snapshot(1, vec![failed, rpc]));
    view.apply(Update {
        seq: 2,
        kind: UpdateKind::Event(event(2, "demo:rpc", TapeKind::ToolError, Severity::Warning)),
    });
    view.apply(Update {
        seq: 6,
        kind: UpdateKind::Event(event(6, "demo:rpc", TapeKind::ToolStart, Severity::Info)),
    });

    let rows: Vec<(&str, String, String)> = view
        .failures(&Filter::default())
        .iter()
        .map(|row| (row.what, row.agent.to_string(), row.detail.clone()))
        .collect();
    assert_eq!(
        rows,
        vec![
            (
                "agent",
                String::from("demo:crashed"),
                String::from("exit 1")
            ),
            (
                "tool",
                String::from("demo:rpc"),
                String::from("Bash cargo test")
            ),
            (
                "tool",
                String::from("demo:rpc"),
                String::from("2 earlier tool errors")
            ),
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

#[test]
fn ended_agents_are_listed_only_briefly_unless_all() {
    let mut view = view();
    let mut old = agent("demo:old", Status::Done, 0);
    old.ended = Some(at(0));
    let mut just_done = agent("demo:just-done", Status::Done, 0);
    just_done.ended = Some(at(0) + TimeDelta::minutes(25));
    // The newest activity sets the view's clock half an hour after `old` ended.
    let working = agent_at(
        "demo:working",
        Status::Working,
        at(0) + TimeDelta::minutes(30),
    );
    view.apply(snapshot(1, vec![old, just_done, working]));

    let ids = |all: bool| -> Vec<String> {
        view.sorted_agents(&Filter {
            all,
            ..Filter::default()
        })
        .iter()
        .map(|agent| agent.id.to_string())
        .collect()
    };
    assert_eq!(ids(false), vec!["demo:working", "demo:just-done"]);
    assert_eq!(
        ids(true),
        vec!["demo:working", "demo:just-done", "demo:old"]
    );
}

#[test]
fn failures_skip_agents_last_seen_before_the_window() {
    let mut view = view();
    let mut old = agent("demo:old-crash", Status::Failed, 0);
    old.tool_errors = 4;
    let recent = agent_at("demo:recent", Status::Working, at(0) + TimeDelta::hours(30));
    view.apply(snapshot(1, vec![old, recent]));

    assert!(view.failures(&Filter::default()).is_empty());
}

/// Counts what the view hands the BODY pane.
#[derive(Clone, Default)]
struct Recorder {
    calls: std::sync::Arc<std::sync::Mutex<(usize, usize)>>,
}

impl crate::body::BodyPane for Recorder {
    fn title(&self) -> &str {
        "RECORDER"
    }

    fn event(&mut self, _event: &TapeEvent) {
        self.calls.lock().expect("lock").0 += 1;
    }

    fn history(&mut self, events: &[TapeEvent]) {
        self.calls.lock().expect("lock").1 += events.len();
    }

    fn totals(&mut self, _totals: &agent_monitor::domain::model::Totals) {}

    fn tick(&mut self, _elapsed: std::time::Duration) {}

    fn animating(&self) -> bool {
        false
    }

    fn render(&self, _area: ratatui::layout::Rect, _buffer: &mut ratatui::buffer::Buffer) {}
}

#[test]
fn a_snapshots_tape_is_history_and_only_live_lines_are_events() {
    let recorder = Recorder::default();
    let mut view = ViewState::new(Box::new(recorder.clone()));

    view.apply(Update {
        seq: 10,
        kind: UpdateKind::Snapshot(Snapshot {
            tape: vec![
                event(1, "hc:t1", TapeKind::ToolStart, Severity::Info),
                event(2, "hc:t1", TapeKind::ToolEnd, Severity::Info),
            ],
            ..Snapshot::default()
        }),
    });
    assert_eq!(*recorder.calls.lock().expect("lock"), (0, 2));

    view.apply(Update {
        seq: 11,
        kind: UpdateKind::Event(event(11, "hc:t1", TapeKind::ToolStart, Severity::Info)),
    });
    assert_eq!(*recorder.calls.lock().expect("lock"), (1, 2));
}

fn pr(number: u32, state: PrState, ci: CiState, updated: u32) -> Pr {
    let repo = agent_monitor::domain::model::RepoName::parse("example-org/widgets").expect("repo");
    let reference = agent_monitor::domain::model::PrRef {
        repo: repo.clone(),
        number,
    };
    Pr {
        id: reference.id(),
        url: reference.url(),
        repo,
        number,
        title: Some(format!("change {number}")),
        state,
        ci,
        review: agent_monitor::domain::model::ReviewState::None,
        mergeable: agent_monitor::domain::model::Mergeable::Mergeable,
        author_agent: Some(AgentId::from_wire(String::from("a"))),
        agents: vec![AgentId::from_wire(String::from("a"))],
        branch: Some(format!("feat/{number}")),
        opened_at: Some(at(0)),
        updated_at: Some(at(updated)),
        closed_at: None,
    }
}

#[test]
fn failing_prs_sort_first_then_open_ones_newest_first_then_finished() {
    let mut view = ViewState::new(Box::new(Vitals::default()));
    let mut snapshot = Snapshot::default();
    snapshot.agents.push(agent("a", Status::Working, 1));
    snapshot.prs = vec![
        pr(1, PrState::Merged, CiState::Failed, 50),
        pr(2, PrState::Open, CiState::Passed, 40),
        pr(3, PrState::Open, CiState::Failed, 10),
        pr(4, PrState::Draft, CiState::Running, 30),
        pr(5, PrState::Closed, CiState::None, 20),
    ];
    view.apply(Update {
        seq: 1,
        kind: UpdateKind::Snapshot(snapshot),
    });

    let order: Vec<u32> = view
        .sorted_prs(&Filter::default())
        .iter()
        .map(|pr| pr.number)
        .collect();
    assert_eq!(order, vec![3, 2, 4, 1, 5]);

    // An update replaces the row; a removal drops it.
    view.apply(Update {
        seq: 2,
        kind: UpdateKind::PrUpsert(pr(3, PrState::Open, CiState::Passed, 55)),
    });
    view.apply(Update {
        seq: 3,
        kind: UpdateKind::PrRemoved(pr(5, PrState::Closed, CiState::None, 0).id),
    });
    let order: Vec<u32> = view
        .sorted_prs(&Filter::default())
        .iter()
        .map(|pr| pr.number)
        .collect();
    assert_eq!(order, vec![3, 2, 4, 1]);

    let filter = Filter {
        words: vec![String::from("draft")],
        ..Filter::default()
    };
    let drafts: Vec<u32> = view
        .sorted_prs(&filter)
        .iter()
        .map(|pr| pr.number)
        .collect();
    assert_eq!(drafts, vec![4]);
}
