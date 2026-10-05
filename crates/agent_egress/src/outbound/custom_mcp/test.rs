use super::*;
use crate::domain::model::{McpServerSlug, UpstreamCredential};
use mcp_client::domain::models::StoredCredentials;
use rmcp::transport::auth::OAuthTokenResponse;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn connected(slug: &str) -> McpDestination {
    McpDestination::Connected(McpServerSlug::parse(slug).expect("a valid slug"))
}

fn custom(url: &str) -> McpDestination {
    McpDestination::Custom(CustomMcpServerKey::for_url(url))
}

/// Records what reached it; the tests only care that delegation happened.
#[derive(Default)]
struct SpyInner {
    asked: Mutex<Vec<String>>,
}

impl McpCredentials for &SpyInner {
    async fn resolve(
        &self,
        _owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<McpResolution, EgressError> {
        let McpDestination::Connected(slug) = destination else {
            unreachable!("the decorator answers custom destinations itself");
        };
        self.asked.lock().expect("lock").push(slug.to_string());
        Err(EgressError::UnknownServer(slug.clone()))
    }
}

/// The owner's rows, verbatim. Lists only: resolution never writes unless a
/// token is refreshed, and nothing here is near expiry.
struct FixedServers {
    records: Vec<McpServerRecord>,
    listed_for: Mutex<Vec<String>>,
}

impl FixedServers {
    fn holding(records: Vec<McpServerRecord>) -> Arc<Self> {
        Arc::new(Self {
            records,
            listed_for: Mutex::default(),
        })
    }
}

impl McpServerStore for FixedServers {
    type Err = std::convert::Infallible;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        unreachable!("nothing here refreshes a token")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        unreachable!("resolution lists, never loads one")
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        unreachable!("resolution never deletes")
    }

    async fn list(
        &self,
        user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        self.listed_for
            .lock()
            .expect("lock")
            .push(user_id.to_string());
        Ok(self.records.clone())
    }
}

fn record(url: &str, name: &str, credentials: Option<StoredCredentials>) -> McpServerRecord {
    McpServerRecord {
        user_id: owner(),
        url: url.to_owned(),
        server_name: name.to_owned(),
        credentials,
        enabled: true,
    }
}

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("after the epoch")
        .as_secs()
}

/// A grant whose access token has an hour left.
fn live_grant(access_token: &str) -> StoredCredentials {
    let response: OAuthTokenResponse = serde_json::from_value(serde_json::json!({
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": 3600,
    }))
    .expect("a token response");
    StoredCredentials::new(
        "client-id".to_owned(),
        Some(response),
        Vec::new(),
        Some(now_epoch_secs()),
    )
}

/// An authorization that registered a client and never exchanged a code:
/// nothing to present, and nothing to refresh with.
fn dead_grant() -> StoredCredentials {
    StoredCredentials::new("client-id".to_owned(), None, Vec::new(), Some(1))
}

const WIKI: &str = "https://wiki.example.com/mcp";

#[tokio::test]
async fn a_connected_server_resolves_to_its_url_with_the_owners_bearer() {
    let servers = FixedServers::holding(vec![record(WIKI, "Wiki", Some(live_grant("wiki-token")))]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, Arc::clone(&servers));

    let McpResolution::Connected(call) = credentials
        .resolve(&owner(), &custom(WIKI))
        .await
        .expect("resolved")
    else {
        panic!("a live grant is connected");
    };

    assert_eq!(call.url().as_str(), WIKI);
    assert_eq!(
        *call.authorization(),
        UpstreamCredential::Bearer(BearerToken::new("wiki-token"))
    );
    assert!(call.scope_headers().is_empty());
    assert_eq!(
        *servers.listed_for.lock().expect("lock"),
        [owner().to_string()]
    );
    assert!(inner.asked.lock().expect("lock").is_empty());
}

/// A server added without connecting an account is dialed bare, as the
/// in-process client dials it; the proxy still strips the session token.
#[tokio::test]
async fn a_server_with_no_account_resolves_anonymously() {
    let servers = FixedServers::holding(vec![record(WIKI, "Wiki", None)]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, servers);

    let McpResolution::Connected(call) = credentials
        .resolve(&owner(), &custom(WIKI))
        .await
        .expect("resolved")
    else {
        panic!("a bare server is connected");
    };

    assert_eq!(*call.authorization(), UpstreamCredential::Anonymous);
}

/// A grant that yields no token is reported as disconnected, with the
/// owner's own name for the server so the model can say which to reconnect.
#[tokio::test]
async fn a_dead_grant_is_reported_disconnected_by_name() {
    let servers = FixedServers::holding(vec![record(WIKI, "Team wiki", Some(dead_grant()))]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, servers);

    let McpResolution::Disconnected { call, name } = credentials
        .resolve(&owner(), &custom(WIKI))
        .await
        .expect("resolved")
    else {
        panic!("a dead grant is disconnected");
    };

    assert_eq!(name, "Team wiki");
    assert_eq!(call.url().as_str(), WIKI);
    assert_eq!(*call.authorization(), UpstreamCredential::Anonymous);
}

/// Only the owner's rows answer, and only enabled ones: a key that matches
/// nobody's row, or a row the owner turned off, has nowhere to go.
#[tokio::test]
async fn an_unknown_or_disabled_key_is_refused() {
    let mut disabled = record(WIKI, "Wiki", None);
    disabled.enabled = false;
    let servers = FixedServers::holding(vec![disabled]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, servers);

    let refusal = credentials
        .resolve(&owner(), &custom(WIKI))
        .await
        .expect_err("disabled");
    assert!(
        matches!(refusal, EgressError::UnknownCustomServer(key) if key == CustomMcpServerKey::for_url(WIKI))
    );

    let refusal = credentials
        .resolve(&owner(), &custom("https://nobody.example.com/mcp"))
        .await
        .expect_err("unknown");
    assert!(matches!(refusal, EgressError::UnknownCustomServer(_)));
}

/// The owner typed the URL, so https is not an assumption: a cleartext
/// server is refused rather than having a token put on the wire for it.
#[tokio::test]
async fn a_cleartext_server_is_refused() {
    const PLAIN: &str = "http://wiki.example.com/mcp";
    let servers = FixedServers::holding(vec![record(PLAIN, "Wiki", Some(live_grant("t")))]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, servers);

    let refusal = credentials
        .resolve(&owner(), &custom(PLAIN))
        .await
        .expect_err("cleartext");
    assert!(matches!(refusal, EgressError::InsecureUpstream(_)));
}

#[tokio::test]
async fn every_other_destination_delegates_to_the_inner_resolver() {
    let servers = FixedServers::holding(vec![record(WIKI, "Wiki", None)]);
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, Arc::clone(&servers));

    let refusal = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect_err("the spy refuses everything");

    assert!(matches!(refusal, EgressError::UnknownServer(_)));
    assert_eq!(*inner.asked.lock().expect("lock"), ["linear"]);
    assert!(
        servers.listed_for.lock().expect("lock").is_empty(),
        "a Pipedream slug must never read the custom rows"
    );
}
