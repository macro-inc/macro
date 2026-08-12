use super::{kind_to_str, parse_kind};
use crate::domain::models::{ActionKind, RemoteAgentTask};

/// `kind` is a plain TEXT column, so the two hand-rolled mappings are the only
/// thing keeping stored rows readable. A variant added to one and not the other
/// turns every row of that kind into a read error at runtime rather than a
/// compile error, so pin the round trip.
#[test]
fn every_kind_round_trips_through_the_text_column() {
    for kind in [ActionKind::Agent, ActionKind::RemoteAgent] {
        let stored = kind_to_str(&kind);
        let parsed = parse_kind(stored).expect("stored kind parses back");

        assert_eq!(kind_to_str(&parsed), stored);
    }
}

#[test]
fn kinds_use_their_serde_names() {
    assert_eq!(kind_to_str(&ActionKind::Agent), "Agent");
    assert_eq!(kind_to_str(&ActionKind::RemoteAgent), "RemoteAgent");
}

#[test]
fn unknown_kinds_are_rejected() {
    assert!(parse_kind("NotAKind").is_err());
    assert!(parse_kind("remoteagent").is_err());
}

/// The `task` column is untyped JSONB and is only interpreted by the executor,
/// so the shape a remote agent action stores is part of this service's contract.
#[test]
fn remote_agent_tasks_deserialize_from_stored_json() {
    let stored = serde_json::json!({
        "endpoint_url": "https://agent.example.com/run",
        "user_prompt": "summarise yesterday's incidents",
        "agent_label": "hermes"
    });

    let task: RemoteAgentTask = serde_json::from_value(stored).expect("valid remote agent task");

    assert_eq!(task.endpoint_url, "https://agent.example.com/run");
    assert_eq!(task.label(), "hermes");
}

#[test]
fn remote_agent_tasks_fall_back_to_a_default_label() {
    let stored = serde_json::json!({
        "endpoint_url": "https://agent.example.com/run",
        "user_prompt": "summarise yesterday's incidents"
    });

    let task: RemoteAgentTask = serde_json::from_value(stored).expect("valid remote agent task");

    assert_eq!(task.label(), "remote-agent");
}
