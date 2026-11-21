use super::TriggerStreamHealth;

#[test]
fn binding_an_agent_after_none_shows_the_connect() {
    let mut health = TriggerStreamHealth::NoAgentsBound;

    assert!(health.agents_bound());
    assert_eq!(health, TriggerStreamHealth::Connecting);
}

/// A live stream closed to follow a changed binding shows the reopen, not a
/// stream that is still live.
#[test]
fn reopening_for_a_changed_binding_shows_the_connect() {
    let mut health = TriggerStreamHealth::Live {
        verified: true,
        last_signal: tokio::time::Instant::now(),
    };

    assert!(health.reopening());
    assert_eq!(health, TriggerStreamHealth::Connecting);
}

#[test]
fn waiting_for_an_agent_is_not_a_reopen() {
    let mut health = TriggerStreamHealth::NoAgentsBound;

    assert!(!health.reopening());
    assert_eq!(health, TriggerStreamHealth::NoAgentsBound);
}

#[test]
fn a_reconnect_keeps_its_attempt_when_agents_are_bound() {
    let mut health = TriggerStreamHealth::Reconnecting {
        attempt: 2,
        last_error: "the event stream stalled".to_owned(),
    };

    assert!(!health.agents_bound());
    assert_eq!(
        health,
        TriggerStreamHealth::Reconnecting {
            attempt: 2,
            last_error: "the event stream stalled".to_owned(),
        }
    );
}
