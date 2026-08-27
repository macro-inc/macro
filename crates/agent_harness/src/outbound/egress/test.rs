use super::*;

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::from_server_name(name).expect("sluggable")
}

#[test]
fn reads_the_repository_out_of_a_configured_url() {
    for url in [
        "https://github.com/macro-inc/macro",
        "https://github.com/macro-inc/macro/",
        "https://github.com/macro-inc/macro.git",
    ] {
        let repo = repo_slug(url).expect(url);
        assert_eq!(repo.to_string(), "macro-inc/macro", "for {url}");
    }
}

#[test]
fn refuses_a_url_that_does_not_name_a_repository() {
    for url in [
        "",
        "not a url",
        "https://github.com",
        "https://github.com/macro-inc",
        "https://gitlab.com/macro-inc/macro",
        "https://github.com.evil.example/macro-inc/macro",
        "https://github.com/macro-inc/macro/tree/main",
    ] {
        assert!(repo_slug(url).is_err(), "accepted {url}");
    }
}

fn egress(slugs: &[&str]) -> SandboxEgress {
    SandboxEgress {
        base_url: "https://egress.macro.com".to_owned(),
        session_token: "session-token".to_owned(),
        mcp_servers: slugs.iter().map(|name| slug(name)).collect(),
    }
}

fn rendered_opencode_config(egress: &SandboxEgress) -> serde_json::Value {
    let config = egress
        .environment()
        .into_iter()
        .find_map(|(name, value)| (name == "OPENCODE_CONFIG_CONTENT").then_some(value))
        .expect("an opencode config in the environment");
    serde_json::from_str(&config).expect("json")
}

/// Every server points at the proxy, carries the session token rather than any
/// upstream credential, and has opencode's own OAuth flow switched off - it
/// wants a browser, and there is not one.
#[test]
fn points_every_server_at_the_proxy_with_oauth_disabled() {
    let parsed = rendered_opencode_config(&egress(&["Datadog (US5)", "Linear"]));
    let servers = parsed["mcp"].as_object().expect("mcp object");

    assert_eq!(servers.len(), 2);
    for (slug, entry) in servers {
        assert_eq!(entry["type"], "remote");
        assert_eq!(entry["url"], format!("https://egress.macro.com/mcp/{slug}"));
        assert_eq!(entry["headers"]["Authorization"], "Bearer session-token");
        assert_eq!(entry["oauth"], false);
    }
    assert!(servers.contains_key("datadog-us5"));
    assert!(servers.contains_key("linear"));
}

#[test]
fn an_owner_with_no_servers_still_gets_a_valid_config() {
    let parsed = rendered_opencode_config(&egress(&[]));

    assert_eq!(parsed, serde_json::json!({ "mcp": {} }));
}

/// The rendered config carries the token as well as the environment, so
/// nothing about this value may reach a log.
#[test]
fn the_egress_environment_does_not_print_its_secrets() {
    let egress = egress(&["Linear"]);

    let printed = format!("{egress:?}");
    assert!(!printed.contains("session-token"), "{printed}");
    assert!(printed.contains("https://egress.macro.com"), "{printed}");

    let environment: Vec<String> = egress
        .environment()
        .into_iter()
        .map(|(name, _value)| name)
        .collect();
    assert_eq!(
        environment,
        [
            "MACRO_EGRESS_URL".to_owned(),
            "MACRO_SESSION_TOKEN".to_owned(),
            "OPENCODE_CONFIG_CONTENT".to_owned(),
        ]
    );
}
