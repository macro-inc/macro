use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use chrono::{TimeZone, Utc};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use super::*;
use crate::domain::model::AgentKind;
use crate::domain::observation::{Fact, TerminalActivity, TerminalFact, TerminalState};

struct FixedClock(Mutex<Timestamp>);

impl Clock for FixedClock {
    fn now(&self) -> Timestamp {
        *self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn start() -> Timestamp {
    Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, 0)
        .single()
        .expect("a valid fixed time")
}

fn terminal(address: &str, name: &str) -> Observation {
    Observation {
        source: SourceKind::Hc,
        change: Change::Upsert(Fact::Terminal(Box::new(TerminalFact {
            address: address.to_owned(),
            name: name.to_owned(),
            parent: None,
            spawned_by: None,
            cwd: Some(PathBuf::from("/work")),
            state: TerminalState::Live,
            activity: Some(TerminalActivity::Idle),
            status_message: None,
            turn: None,
            created: Some(start()),
            finished: None,
            exit_code: None,
            finish_reason: None,
            foreground_pid: None,
            program: None,
            kind: Some(AgentKind::Builder),
            model: None,
            space: None,
            goal: None,
            waiting: false,
            manager_dir: None,
            macrod_session: None,
            run_id: None,
            tags: Vec::new(),
        }))),
    }
}

fn store() -> (Store, CancellationToken) {
    let cancel = CancellationToken::new();
    let store = Store::start(
        StoreConfig::default(),
        Arc::new(FixedClock(Mutex::new(start()))),
        &TaskTracker::new(),
        cancel.clone(),
    );
    (store, cancel)
}

/// The next agent row published, skipping tape lines and other updates.
async fn next_upsert(updates: &mut broadcast::Receiver<Arc<Update>>) -> (u64, Agent) {
    loop {
        let update = updates.recv().await.expect("the store is running");
        if let UpdateKind::Upsert(agent) = &update.kind {
            return (update.seq, agent.clone());
        }
    }
}

#[tokio::test(start_paused = true)]
async fn subscriber_gets_snapshot_then_rising_updates() {
    let (store, cancel) = store();
    let observations = store.observations();
    observations
        .send(terminal("t1", "one"))
        .await
        .expect("store open");
    let mut first = store.subscribe();
    let (seq, agent) = next_upsert(&mut first.updates).await;
    assert_eq!(agent.id, AgentId::terminal("t1"));

    let late = store.subscribe();
    let UpdateKind::Snapshot(snapshot) = &late.snapshot.kind else {
        panic!("a subscription starts with a snapshot");
    };
    assert!(late.snapshot.seq >= seq);
    assert_eq!(snapshot.agents.len(), 1);
    assert_eq!(
        snapshot.tape.len(),
        1,
        "a fresh agent writes a spawned line"
    );
    cancel.cancel();
}

#[tokio::test(start_paused = true)]
async fn unchanged_rows_emit_nothing_and_bursts_coalesce() {
    let (store, cancel) = store();
    let mut subscription = store.subscribe();
    let observations = store.observations();

    for name in ["a", "b", "c", "d"] {
        observations
            .send(terminal("t1", name))
            .await
            .expect("store open");
    }
    let (_, agent) = next_upsert(&mut subscription.updates).await;
    assert_eq!(agent.name, "d", "a burst publishes only the last row");

    observations
        .send(terminal("t1", "d"))
        .await
        .expect("store open");
    observations
        .send(terminal("t2", "two"))
        .await
        .expect("store open");
    let (_, agent) = next_upsert(&mut subscription.updates).await;
    assert_eq!(
        agent.id,
        AgentId::terminal("t2"),
        "the unchanged t1 row is not republished"
    );
    cancel.cancel();
}

#[test]
fn totals_never_show_zero_spend_when_nothing_reported() {
    let totals = totals(
        &BTreeMap::new(),
        &BTreeMap::new(),
        Vec::new(),
        start(),
        FixedOffset::east_opt(0).expect("a valid offset"),
    );
    assert_eq!(totals.cost_today, Cost::Unpriced);
}

/// A Claude transcript with one usage record per given time.
fn spending_transcript(session: &str, at: &[Timestamp]) -> Fact {
    use crate::domain::model::Tokens;
    use crate::domain::observation::{
        TranscriptDelta, TranscriptEvent, TranscriptKey, TranscriptProgram,
    };

    Fact::Transcript(TranscriptDelta {
        key: TranscriptKey {
            program: TranscriptProgram::Claude,
            session: session.to_owned(),
            subagent: None,
        },
        path: PathBuf::from(format!("/t/{session}.jsonl")),
        from_start: true,
        cwd: None,
        branch: None,
        model: Some("claude-opus-5-5".to_owned()),
        title: None,
        events: at
            .iter()
            .map(|at| TranscriptEvent {
                at: *at,
                kind: TranscriptEventKind::Usage(Tokens {
                    input: 1_000_000,
                    ..Tokens::default()
                }),
            })
            .collect(),
    })
}

#[test]
fn spend_by_kind_covers_only_today_and_adds_up_to_the_day() {
    let now = start();
    let yesterday = Utc
        .with_ymd_and_hms(2026, 1, 1, 22, 0, 0)
        .single()
        .expect("a valid fixed time");
    let offset = FixedOffset::east_opt(0).expect("a valid offset");
    let mut facts = Facts::default();
    // One session spent yesterday and today; the other only today.
    facts.apply(
        Observation {
            source: SourceKind::ClaudeTranscripts,
            change: Change::Reset(vec![
                spending_transcript("s-long", &[yesterday, now - TimeDelta::hours(1)]),
                spending_transcript("s-new", &[now - TimeDelta::minutes(5)]),
            ]),
        },
        now,
    );
    let built = build_agents(&facts, now);

    let spend = spend_by_kind(
        &spend_since(&facts, midnight(now, offset), now),
        &built.owners,
        &built.agents,
    );
    let totals = totals(
        &built.agents,
        &minute_counts(&facts, now),
        spend,
        now,
        offset,
    );

    let day = totals.cost_today.usd().expect("spend today");
    let kinds: f64 = totals.spend_by_kind.iter().map(|(_, usd)| usd).sum();
    assert!((kinds - day).abs() < 1e-6, "kinds {kinds} vs day {day}");
    let lifetime: f64 = built
        .agents
        .values()
        .filter_map(|agent| agent.cost.usd())
        .sum();
    assert!(
        lifetime > day + 1e-6,
        "yesterday's spend stays out of the day: lifetime {lifetime}, day {day}"
    );
}
