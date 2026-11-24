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
fn the_agent_exports_to_a_reachable_intake_tagged_with_the_deployment_and_to_none_on_loopback() {
    use macro_service_urls::macro_env::Environment;
    assert_eq!(
        telemetry(
            "https://macro-prox-dev.macroverse.workers.dev/i/otlp",
            Environment::Develop
        )
        .unwrap(),
        vec![
            (
                TELEMETRY_KEY,
                "https://macro-prox-dev.macroverse.workers.dev/i/otlp".to_owned()
            ),
            (TELEMETRY_ENVIRONMENT_KEY, "dev".to_owned()),
        ]
    );
    assert_eq!(
        telemetry("http://otel-collector:4318", Environment::Local).unwrap(),
        vec![
            (TELEMETRY_KEY, "http://otel-collector:4318".to_owned()),
            (TELEMETRY_ENVIRONMENT_KEY, "local".to_owned()),
        ]
    );
    assert_eq!(
        telemetry("http://localhost:4318", Environment::Local).unwrap(),
        Vec::new()
    );
    assert!(telemetry("https://user:pass@intake.example.com", Environment::Develop).is_err());
}
