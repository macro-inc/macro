use super::*;
use crate::domain::model::{McpDestination, McpResolution};
use http::header::{HeaderMap, HeaderValue};
use pipedream_mcp::outbound::api::McpUpstreamCall;
use std::sync::Mutex;
use url::Url;

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
        let mut headers = HeaderMap::new();
        headers.insert(
            "x-pd-external-user-id",
            HeaderValue::from_str(&record.user_id.to_string()).expect("a header value"),
        );
        headers.insert(
            "x-pd-app-slug",
            HeaderValue::from_str(&record.app_slug).expect("a header value"),
        );
        Ok(McpUpstreamCall {
            url: Url::parse(self.url).expect("a url"),
            bearer_token: "project-token".to_owned(),
            headers,
        })
    }
}

fn connected(slug: &str) -> McpDestination {
    McpDestination::Connected(McpServerSlug::parse(slug).expect("a valid slug"))
}

/// The slug a sandbox dials is Pipedream's `app_slug`, byte for byte -
/// nothing is derived at either end, so the docs' spelling is the dialable
/// spelling.
#[tokio::test]
async fn resolves_an_app_slug_verbatim() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("google_sheets", true)])),
        upstream.clone(),
    );

    let McpResolution::Connected(call) = credentials
        .resolve(&owner(), &connected("google_sheets"))
        .await
        .expect("resolved")
    else {
        panic!("a connected app resolves as connected");
    };

    assert_eq!(call.url().as_str(), "https://remote.mcp.pipedream.net/");
    let asked = upstream.asked_for.lock().expect("spy lock");
    assert_eq!(asked.len(), 1);
    assert_eq!(asked[0].app_slug, "google_sheets");
}

#[tokio::test]
async fn carries_the_scoping_headers_next_to_the_bearer() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("linear", true)])),
        upstream.clone(),
    );

    let McpResolution::Connected(call) = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect("resolved")
    else {
        panic!("a connected app resolves as connected");
    };

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

/// A disabled connection resolves like no connection: the owner turned the
/// app off, and that takes the grant away from the sandbox. What remains is
/// an addressable upstream with no grant behind it, which the service treats
/// according to the session's policy.
#[tokio::test]
async fn a_disabled_connection_resolves_as_unconnected() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials = PipedreamMcpCredentials::new(
        Arc::new(FixedConnections(vec![connection("linear", false)])),
        upstream.clone(),
    );

    let resolution = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect("resolved");

    assert!(
        matches!(resolution, McpResolution::Unconnected(_)),
        "{resolution:?}"
    );
    let asked = upstream.asked_for.lock().expect("spy lock");
    assert_eq!(asked.len(), 1);
    assert!(
        asked[0].account_id.is_empty(),
        "the disabled row's account is not what gets addressed"
    );
}

/// An app nobody connected is still addressable for the owner - Pipedream
/// scopes by user id and app slug alone - so it resolves as unconnected with
/// exactly the owner's scoping, and no grant.
#[tokio::test]
async fn a_slug_nobody_connected_resolves_as_unconnected_for_the_owner() {
    let upstream = SpyUpstream::at("https://remote.mcp.pipedream.net");
    let credentials =
        PipedreamMcpCredentials::new(Arc::new(FixedConnections(Vec::new())), upstream.clone());

    let McpResolution::Unconnected(call) = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect("resolved")
    else {
        panic!("an unconnected app resolves as unconnected");
    };

    let scope: Vec<(&str, &str)> = call
        .scope_headers()
        .iter()
        .map(|(name, value)| (name.as_str(), value.to_str().expect("ascii")))
        .collect();
    assert!(scope.contains(&("x-pd-app-slug", "linear")), "{scope:?}");
    let owner_id = owner().to_string();
    assert!(
        scope.contains(&("x-pd-external-user-id", owner_id.as_str())),
        "{scope:?}"
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
        .resolve(&owner(), &connected("linear"))
        .await
        .expect_err("refused");

    assert!(
        matches!(refusal, EgressError::InsecureUpstream(_)),
        "{refusal}"
    );
}
