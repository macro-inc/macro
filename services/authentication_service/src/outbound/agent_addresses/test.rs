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
fn a_browser_url_may_be_local_but_must_be_plain_http() {
    assert_eq!(
        browser_url("X", "http://localhost:3000/").unwrap(),
        "http://localhost:3000"
    );
    assert_eq!(
        browser_url("X", "https://macro.com").unwrap(),
        "https://macro.com"
    );
    for raw in [
        "javascript:alert(1)",
        "https://user:pass@macro.com",
        "https://macro.com/?a=1",
        "https://macro.com/#x",
    ] {
        assert!(browser_url("X", raw).is_err(), "{raw}");
    }
}
