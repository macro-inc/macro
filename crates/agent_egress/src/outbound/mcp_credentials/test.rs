use super::*;
use pipedream_mcp::domain::models::McpUpstreamCall;
use std::sync::Mutex;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn connection(app_slug: &str, enabled: bool) -> PipedreamConnection {
    PipedreamConnection {
        user_id: owner(),
        app_slug: app_slug.to_owned(),
        server_name: format!("{app_slug} display name"),
        account_id: format!("apn_{app_slug}"),
        enabled,
    }
}

struct FixedConnections(Vec<PipedreamConnection>);

impl ConnectionStore for FixedConnections {
    type Err = std::convert::Infallible;

    async fn save(&self, _record: &PipedreamConnection) -> Result<(), Self::Err> {
        unreachable!("resolution never writes")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<Option<PipedreamConnection>, Self::Err> {
        unreachable!("resolution lists, never loads one")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _app_slug: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("resolution never deletes")
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<PipedreamConnection>, Self::Err> {
        Ok(self.0.clone())
    }
}

/// Records which connection it was asked to address, and answers with a fixed
/// upstream shaped like the real client's. Cloning shares one record.
#[derive(Clone)]
struct SpyUpstream {
    url: &'static str,
    asked_for: Arc<Mutex<Vec<PipedreamConnection>>>,
}

impl SpyUpstream {
    fn at(url: &'static str) -> Self {
        Self {
            url,
            asked_for: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl McpUpstream for SpyUpstream {
    async fn upstream(&self, record: &PipedreamConnection) -> anyhow::Result<McpUpstreamCall> {
        self.asked_for
            .lock()
            .expect("spy lock should not be poisoned")
            .push(record.clone());
        Ok(McpUpstreamCall {
            url: self.url.to_owned(),
            bearer_token: "project-token".to_owned(),
            headers: vec![
                (
                    "x-pd-external-user-id".to_owned(),
                    record.user_id.to_string(),
                ),
                ("x-pd-app-slug".to_owned(), record.app_slug.clone()),
            ],
        })
    }
}

fn slug(name: &str) -> McpServerSlug {
    McpServerSlug::from_server_name(name).expect("sluggable")
}

#[tokio::test]
async fn resolves_an_underscored_app_slug_by_its_dashed_form() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("google_sheets", true)])),
        upstream.clone(),
    );

    // The sandbox dials the dashed form: `from_server_name` collapsed the
    // underscore when the config was generated, and `parse` on the request
    // path rejects underscores outright.
    let call = credentials
        .resolve(&owner(), &slug("google_sheets"))
        .await
        .expect("resolved");

    assert_eq!(call.url().as_str(), "https://remote.mcp.pipedream.net/");
    let asked = upstream.asked_for.lock().expect("spy lock");
    assert_eq!(asked.len(), 1);
    // The upstream is asked for the record as stored - Pipedream wants the
    // underscored slug back, whatever the path segment looked like.
    assert_eq!(asked[0].app_slug, "google_sheets");
}

#[tokio::test]
async fn carries_the_scoping_headers_next_to_the_bearer() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        upstream.clone(),
    );

    let call = credentials
        .resolve(&owner(), &slug("linear"))
        .await
        .expect("resolved");

    let scope: Vec<(&str, &str)> = call
        .scope_headers()
        .iter()
        .map(|(name, value)| (name.as_str(), value.to_str().expect("ascii")))
        .collect();
    assert!(scope.contains(&("x-pd-app-slug", "linear")), "{scope:?}");
    assert!(
        scope
            .iter()
            .any(|(name, _)| *name == "x-pd-external-user-id"),
        "{scope:?}"
    );
}

#[tokio::test]
async fn a_disabled_connection_is_an_unknown_server() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("linear", false)])),
        upstream.clone(),
    );

    let refusal = credentials
        .resolve(&owner(), &slug("linear"))
        .await
        .expect_err("refused");

    assert!(
        matches!(refusal, EgressError::UnknownServer(_)),
        "{refusal}"
    );
    assert!(
        upstream.asked_for.lock().expect("spy lock").is_empty(),
        "a disabled connection must never reach Pipedream"
    );
}

#[tokio::test]
async fn a_slug_nobody_connected_is_an_unknown_server() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials =
        PipedreamMcpCredentials::new(Arc::new(FixedConnections(Vec::new())), upstream.clone());

    let refusal = credentials
        .resolve(&owner(), &slug("linear"))
        .await
        .expect_err("refused");

    assert!(
        matches!(refusal, EgressError::UnknownServer(_)),
        "{refusal}"
    );
}

#[tokio::test]
async fn refuses_a_cleartext_upstream() {
    let upstream = SpyUpstream::at("http://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        upstream.clone(),
    );

    let refusal = credentials
        .resolve(&owner(), &slug("linear"))
        .await
        .expect_err("refused");

    assert!(
        matches!(refusal, EgressError::InsecureUpstream(_)),
        "{refusal}"
    );
}
