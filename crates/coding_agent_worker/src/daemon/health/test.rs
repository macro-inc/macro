use super::TriggerStreamHealth;

#[test]
fn binding_an_agent_after_none_shows_the_connect() {
    let mut health = TriggerStreamHealth::NoAgentsBound;

    assert!(health.agents_bound());
    assert_eq!(health, TriggerStreamHealth::Connecting);
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
