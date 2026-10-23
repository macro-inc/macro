use super::*;
use serde_json::json;

#[test]
fn pipedream_apps_are_identified_by_their_slug() {
    assert_eq!(
        serde_json::to_value(IntegrationEvent::pipedream("google_drive")).unwrap(),
        json!({ "provider": "google_drive", "connection_type": "pipedream" })
    );
}

#[test]
fn mcp_servers_are_identified_by_host_without_path_or_query() {
    assert_eq!(
        serde_json::to_value(IntegrationEvent::mcp_server(
            "https://mcp.example.com/sse/abc123?token=secret"
        ))
        .unwrap(),
        json!({ "provider": "mcp.example.com", "connection_type": "mcp_server" })
    );
}

#[test]
fn unparseable_mcp_server_urls_are_recorded_as_unknown() {
    assert_eq!(
        serde_json::to_value(IntegrationEvent::mcp_server("not a url")).unwrap(),
        json!({ "provider": "unknown", "connection_type": "mcp_server" })
    );
}

fn mcp_server_record(
    credentials: Option<mcp_client::domain::models::StoredCredentials>,
) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|user-1@example.com").unwrap(),
        url: "https://mcp.linear.app/mcp".to_owned(),
        server_name: "Linear".to_owned(),
        credentials,
        enabled: true,
    }
}

#[test]
fn removing_an_authenticated_mcp_server_is_a_disconnect() {
    let credentials = mcp_client::domain::models::StoredCredentials::new(
        "client".to_owned(),
        None,
        Vec::new(),
        None,
    );

    assert_eq!(
        IntegrationEvent::removed_mcp_server(&mcp_server_record(Some(credentials))),
        Some(IntegrationEvent::mcp_server("https://mcp.linear.app/mcp"))
    );
}

#[test]
fn removing_a_server_that_never_finished_oauth_is_not_a_disconnect() {
    assert_eq!(
        IntegrationEvent::removed_mcp_server(&mcp_server_record(None)),
        None
    );
}
