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
