use super::*;
use macro_user_id::user_id::MacroUserIdStr;

fn native(url: &str, enabled: bool, authenticated: bool) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        url: url.to_owned(),
        server_name: "Renamed by user".into(),
        enabled,
        credentials: authenticated.then(|| {
            serde_json::from_value(serde_json::json!({"client_id":"test", "token_response":null}))
                .unwrap()
        }),
    }
}
fn pd(slug: &str, enabled: bool) -> PipedreamConnection {
    PipedreamConnection {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        app_slug: slug.into(),
        server_name: slug.into(),
        account_id: "account".into(),
        enabled,
    }
}

#[test]
fn native_and_pipedream_providers_coexist_without_duplicates() {
    let (native, pd) = select_connections(
        vec![
            native("https://mcp.linear.app/mcp/", true, true),
            native("https://mcp.linear.app/mcp", true, true),
        ],
        vec![
            pd("linear", true),
            pd("stripe", true),
            pd("slack_v2", true),
            pd("slack", true),
        ],
    );
    assert_eq!(native.len(), 1);
    assert_eq!(
        pd.iter().map(|r| r.app_slug.as_str()).collect::<Vec<_>>(),
        ["stripe", "slack"]
    );
}

#[test]
fn disabled_or_unauthenticated_native_does_not_hide_enabled_pipedream() {
    for (enabled, authenticated) in [(false, true), (true, false)] {
        let (native, pd) = select_connections(
            vec![native("https://mcp.linear.app/mcp", enabled, authenticated)],
            vec![pd("linear", true), pd("stripe", false)],
        );
        assert!(native.is_empty());
        assert_eq!(pd.len(), 1);
        assert_eq!(pd[0].app_slug, "linear");
    }
}

#[test]
fn disabled_alias_does_not_shadow_enabled_alias() {
    let (_, pd) = select_connections(vec![], vec![pd("slack", false), pd("slack_v2", true)]);
    assert_eq!(pd.len(), 1);
    assert_eq!(pd[0].app_slug, "slack_v2");
}

#[test]
fn unrelated_custom_servers_are_preserved_and_do_not_match_by_display_name() {
    let (native, pd) = select_connections(
        vec![native("https://example.com/mcp", true, false)],
        vec![pd("linear", true)],
    );
    assert_eq!(native.len(), 1);
    assert_eq!(pd.len(), 1);
}
