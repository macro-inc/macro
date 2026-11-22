use super::*;

fn native(url: &str, enabled: bool, authenticated: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        url: url.to_owned(),
        server_name: "Sentry (work)".into(),
        enabled,
        credentials: authenticated.then(|| {
            serde_json::from_value(serde_json::json!({"client_id":"test", "token_response":null}))
                .unwrap()
        }),
    }
}

fn sentry() -> ConnectorOverlay {
    ConnectorOverlay {
        app_slug: "sentry".into(),
        server_url: "https://mcp.sentry.dev/mcp".into(),
    }
}

#[test]
fn only_an_enabled_authorized_row_for_the_overlay_endpoint_counts() {
    let rows = [
        native("https://mcp.sentry.dev/mcp", false, true),
        native("https://mcp.sentry.dev/mcp", true, false),
        native("https://mcp.linear.app/mcp", true, true),
    ];
    assert!(overlay_connection(&rows, &sentry()).is_none());

    let rows = [native("https://mcp.sentry.dev/mcp/", true, true)];
    assert_eq!(
        overlay_connection(&rows, &sentry()).map(|r| r.server_name.as_str()),
        Some("Sentry (work)")
    );
}
