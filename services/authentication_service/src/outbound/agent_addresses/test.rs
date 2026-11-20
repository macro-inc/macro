use super::*;

#[test]
fn a_reachable_https_base_is_accepted_without_its_trailing_slash() {
    assert_eq!(
        checked("X", "https://dev-gateway.macro.com/dss/", false).unwrap(),
        "https://dev-gateway.macro.com/dss"
    );
    assert_eq!(
        checked("X", "wss://dev-gateway.macro.com/ws", true).unwrap(),
        "wss://dev-gateway.macro.com/ws"
    );
}

#[test]
fn loopback_credentialed_or_wrong_scheme_addresses_are_refused() {
    for (raw, websocket) in [
        ("http://localhost:8080", false),
        ("http://127.0.0.1:8080", false),
        ("https://user:pass@macro.com", false),
        ("https://macro.com/?a=1", false),
        ("wss://macro.com/ws", false),
        ("https://macro.com", true),
    ] {
        assert!(checked("X", raw, websocket).is_err(), "{raw}");
    }
}

#[test]
fn an_own_machine_gets_the_public_addresses_never_a_fleets_override() {
    let variables = PublicAgentAddresses(Environment::Production)
        .environment()
        .unwrap();
    let value = |key: &str| {
        variables
            .iter()
            .find(|(name, _)| *name == key)
            .map(|(_, value)| value.clone())
            .unwrap()
    };

    assert_eq!(value(GATEWAY_KEY), "https://gateway.macro.com");
    assert_eq!(
        value(ANTHROPIC_BASE_URL_KEY),
        "https://gateway.macro.com/agent-harness-egress/brain/anthropic"
    );
}

#[test]
fn the_agent_exports_to_a_reachable_intake_and_to_none_on_loopback() {
    assert_eq!(
        telemetry("https://macro-prox-dev.macroverse.workers.dev/i/otlp").unwrap(),
        Some((
            TELEMETRY_KEY,
            "https://macro-prox-dev.macroverse.workers.dev/i/otlp".to_owned()
        ))
    );
    assert_eq!(telemetry("http://localhost:4318").unwrap(), None);
    assert!(telemetry("https://user:pass@intake.example.com").is_err());
}

fn in_network() -> ServiceUrls {
    ServiceUrls {
        storage: "http://document-storage-service:8080".to_owned(),
        auth: "http://authentication-service:8080".to_owned(),
        cognition: "http://agent-harness-service:8080/cognition".to_owned(),
        harness: "http://agent-harness-service:8080".to_owned(),
        scheduled: "http://agent-harness-service:8080/scheduled-action".to_owned(),
        connection: "ws://connection-gateway:8080".to_owned(),
        mcp: "http://agent-harness-service:8080".to_owned(),
        gateway: "http://api-gateway:8080".to_owned(),
        egress: "http://agent-harness-service:8081".to_owned(),
        intake: "http://lgtm:4318".to_owned(),
    }
}

#[test]
fn a_local_stacks_own_machine_gets_the_stacks_computer_facing_addresses() {
    assert_eq!(
        own_machine(Environment::Local, || Ok(in_network())).unwrap(),
        in_network()
    );
}

#[test]
fn a_deployed_own_machine_never_gets_the_computer_facing_addresses() {
    for environment in [Environment::Develop, Environment::Production] {
        assert_eq!(
            own_machine(environment, || panic!(
                "a deployed machine reads no override"
            ))
            .unwrap(),
            public(environment),
            "{environment:?}"
        );
    }
}
