use std::collections::BTreeSet;

use chrono::{TimeZone, Utc};

use super::*;
use crate::domain::join::{Facts, build_agents};
use crate::domain::model::Status;

fn start() -> Timestamp {
    Utc.with_ymd_and_hms(2026, 1, 2, 10, 0, 0)
        .single()
        .expect("a valid fixed time")
}

#[test]
fn the_script_is_deterministic_for_a_seed() {
    let step = Duration::from_millis(250);
    assert_eq!(script(7, start(), step, 400), script(7, start(), step, 400));
    assert_ne!(script(7, start(), step, 400), script(8, start(), step, 400));
}

#[test]
fn the_fleet_drives_every_pane() {
    let step = Duration::from_millis(250);
    let steps = 400;
    let end = start() + TimeDelta::milliseconds(250 * i64::from(steps));
    let mut facts = Facts::default();
    let mut tape_events = 0;
    for observation in script(7, start(), step, steps) {
        tape_events += facts.apply(observation, end).len();
    }
    let built = build_agents(&facts, end);
    let agents: Vec<&Agent> = built.agents.values().collect();

    assert!(agents.len() >= 15, "{} agents", agents.len());
    let kinds: BTreeSet<&str> = agents.iter().map(|agent| agent.kind.label()).collect();
    for kind in [
        "manager", "builder", "explorer", "planner", "chatter", "reviewer", "subagent", "shell",
        "other",
    ] {
        assert!(kinds.contains(kind), "no {kind} in {kinds:?}");
    }
    assert!(agents.iter().any(|agent| !agent.children.is_empty()));
    assert!(agents.iter().any(|agent| agent.status == Status::Failed));
    assert!(agents.iter().any(|agent| agent.tool_errors > 0));
    assert!(
        agents
            .iter()
            .any(|agent| agent.cost.usd().is_some_and(|usd| usd > 0.0))
    );
    assert!(
        agents
            .iter()
            .any(|agent| agent.activity.iter().any(|count| *count > 0))
    );
    assert!(tape_events > 100);
}

#[test]
fn the_snapshot_is_deterministic_and_has_a_tape() {
    let step = Duration::from_millis(250);
    let first = snapshot(7, start(), step, 400);
    assert_eq!(first, snapshot(7, start(), step, 400));
    assert!(first.agents.len() >= 15);
    assert!(first.tape.len() > 50, "{} tape lines", first.tape.len());
    assert!(first.totals.tools_24h > 0);
    assert!(first.totals.working + first.totals.waiting + first.totals.blocked > 0);
}
