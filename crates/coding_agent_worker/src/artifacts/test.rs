use super::*;
use serde_json::json;

fn local_server() -> LocalServer {
    LocalServer {
        program: "/opt/macrod/bin/macrod".into(),
        web_url: "https://macro.com/app".to_owned(),
    }
}

#[test]
fn a_session_with_macros_server_gets_macrods_rooted_at_its_workspace() {
    let mut params = json!({
        "cwd": "/home/operator/code",
        "mcpServers": [{
            "type": "http",
            "name": "macro",
            "url": "https://egress.macro.com/mcp-macro",
            "headers": [{"name": "Authorization", "value": "Bearer session-token"}]
        }]
    });

    assert!(local_server().add_to(&mut params));

    assert_eq!(
        params["mcpServers"][1],
        json!({
            "name": "macrod",
            "command": "/opt/macrod/bin/macrod",
            "args": ["mcp", "artifacts"],
            "env": [
                {"name": "MACROD_EGRESS_URL", "value": "https://egress.macro.com"},
                {"name": "MACROD_SESSION_TOKEN", "value": "session-token"},
                {"name": "MACROD_WEB_URL", "value": "https://macro.com/app"},
                {"name": "MACROD_ARTIFACT_ROOT", "value": "/home/operator/code"}
            ]
        })
    );
}

#[test]
fn a_session_is_given_macrods_server_once() {
    let mut params = json!({
        "cwd": "/home/operator/code",
        "mcpServers": [{
            "type": "http",
            "name": "macro",
            "url": "https://egress.macro.com/mcp-macro",
            "headers": [{"name": "authorization", "value": "Bearer session-token"}]
        }]
    });

    assert!(local_server().add_to(&mut params));
    assert!(local_server().add_to(&mut params));

    assert_eq!(params["mcpServers"].as_array().map(Vec::len), Some(2));
}

/// Without Macro's own server there is no egress or session token to
/// publish through, so nothing is added.
#[test]
fn a_session_without_macros_server_gets_nothing() {
    let mut params = json!({
        "cwd": "/home/operator/code",
        "mcpServers": [{
            "type": "http",
            "name": "linear",
            "url": "https://egress.macro.com/mcp/linear",
            "headers": [{"name": "Authorization", "value": "Bearer session-token"}]
        }]
    });

    assert!(!local_server().add_to(&mut params));

    assert_eq!(params["mcpServers"].as_array().map(Vec::len), Some(1));
}

#[cfg(unix)]
#[test]
fn an_unrooted_server_keeps_everything_but_its_root() {
    let mut servers = vec![json!({
        "name": "macrod",
        "command": "/opt/macrod/bin/macrod",
        "args": ["mcp", "artifacts"],
        "env": [
            {"name": "MACROD_EGRESS_URL", "value": "https://egress.macro.com"},
            {"name": "MACROD_ARTIFACT_ROOT", "value": "/home/operator/code"}
        ]
    })];

    unroot(&mut servers);

    assert_eq!(
        servers[0]["env"],
        json!([{"name": "MACROD_EGRESS_URL", "value": "https://egress.macro.com"}])
    );
}

#[test]
fn links_open_the_artifact_and_each_scene_in_the_web_app() {
    let (page, scenes) = web_links(
        "https://macro.com/app/",
        "0198a7b2-6c1d-7f00-8000-000000000001",
        &[publish::Scene {
            id: "empty-state".to_owned(),
            title: "Empty state".to_owned(),
            path: "scenes/empty.html".to_owned(),
        }],
    );

    assert_eq!(
        page,
        "https://macro.com/app/artifact/0198a7b2-6c1d-7f00-8000-000000000001"
    );
    assert_eq!(
        Value::Object(scenes),
        json!({"empty-state": "https://macro.com/app/artifact/0198a7b2-6c1d-7f00-8000-000000000001?scene=empty-state"})
    );
}
