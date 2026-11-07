use super::*;
use serde_json::json;

#[test]
fn server_events_turn_off_geoip_and_keep_their_properties() {
    assert_eq!(
        capture_payload(
            "phc_test",
            "macro|user@example.com",
            "integration_connected",
            json!({ "provider": "linear" }),
        ),
        json!({
            "api_key": "phc_test",
            "event": "integration_connected",
            "distinct_id": "macro|user@example.com",
            "properties": { "provider": "linear", "$geoip_disable": true },
        })
    );
}

#[test]
fn events_without_properties_still_turn_off_geoip() {
    assert_eq!(
        capture_payload("phc_test", "macro|user@example.com", "team_create", ())["properties"],
        json!({ "$geoip_disable": true })
    );
}
