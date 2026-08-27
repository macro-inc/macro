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

struct FixedConnections(Vec<pipedream_mcp::domain::models::PipedreamConnection>);

impl ConnectionStore for FixedConnections {
    type Err = std::convert::Infallible;

    async fn save(
        &self,
        _record: &pipedream_mcp::domain::models::PipedreamConnection,
    ) -> Result<(), Self::Err> {
        unreachable!("provisioning never writes")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<Option<pipedream_mcp::domain::models::PipedreamConnection>, Self::Err> {
        unreachable!("provisioning lists, never loads one")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("provisioning never deletes")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<pipedream_mcp::domain::models::PipedreamConnection>, Self::Err> {
        Ok(self.0.clone())
    }
}

fn connection(app_slug: &str, enabled: bool) -> pipedream_mcp::domain::models::PipedreamConnection {
    pipedream_mcp::domain::models::PipedreamConnection {
        user_id: MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
        app_slug: app_slug.to_owned(),
        server_name: app_slug.to_owned(),
        account_id: format!("apn_{app_slug}"),
        enabled,
    }
}

/// The reserved slug leads every session's list, and a connected app that
/// would collide with it is dropped rather than left to silently resolve to
/// Macro's server under its own name.
#[tokio::test]
async fn every_session_gets_the_macro_server_first() {
    let provisioner = EgressProvisioner::new(
        Arc::new(FixedConnections(vec![
            connection("linear", true),
            connection("macro", true),
            connection("datadog", false),
        ])),
        "https://egress.macro.com",
    );

    let provisioned = provisioner
        .provision(
            AgentSessionId::new(),
            &MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id"),
            "https://github.com/macro-inc/macro",
        )
        .await
        .expect("provisioned");

    let slugs: Vec<String> = provisioned
        .sandbox
        .mcp_servers
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(slugs, ["macro", "linear"]);
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
