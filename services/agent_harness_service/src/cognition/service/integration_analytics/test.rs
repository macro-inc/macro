use super::*;
use connectors::{ConnectorId, ServerUrl};
use serde_json::json;

#[test]
fn apps_are_identified_by_their_slug() {
    let key = ConnectorKey::App(ConnectorId::parse("google_drive").unwrap());

    assert_eq!(
        serde_json::to_value(IntegrationEvent::of(&key)).unwrap(),
        json!({ "provider": "google_drive", "connection_type": "app" })
    );
}

#[test]
fn an_aliased_app_is_identified_by_the_app_it_names() {
    let key = ConnectorKey::App(ConnectorId::parse("slack_v2").unwrap());

    assert_eq!(
        serde_json::to_value(IntegrationEvent::of(&key)).unwrap(),
        json!({ "provider": "slack", "connection_type": "app" })
    );
}

#[test]
fn servers_are_identified_by_host_without_path_or_query() {
    let key = ConnectorKey::Server(
        ServerUrl::parse("https://mcp.example.com/sse/abc123?token=secret").unwrap(),
    );

    assert_eq!(
        serde_json::to_value(IntegrationEvent::of(&key)).unwrap(),
        json!({ "provider": "mcp.example.com", "connection_type": "mcp_server" })
    );
}

#[test]
fn unparseable_server_urls_are_recorded_as_unknown() {
    assert_eq!(
        serde_json::to_value(IntegrationEvent::mcp_server("not a url")).unwrap(),
        json!({ "provider": "unknown", "connection_type": "mcp_server" })
    );
}
