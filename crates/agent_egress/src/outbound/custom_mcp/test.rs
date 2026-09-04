use super::*;
use crate::domain::model::McpServerSlug;
use mcp_client::domain::models::{McpServerRecord, StoredCredentials};
use oauth2::{AccessToken, basic::BasicTokenType};
use rmcp::transport::auth::{OAuthTokenResponse, VendorExtraTokenFields};
use std::sync::Mutex;

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn connected(slug: &str) -> McpDestination {
    McpDestination::Connected(McpServerSlug::parse(slug).expect("a valid slug"))
}

fn custom(url: &str) -> (CustomMcpId, McpDestination) {
    let id = CustomMcpId::from_url(url);
    (id.clone(), McpDestination::Custom(id))
}

fn token_response(access_token: &str) -> OAuthTokenResponse {
    OAuthTokenResponse::new(
        AccessToken::new(access_token.to_owned()),
        BasicTokenType::Bearer,
        VendorExtraTokenFields::default(),
    )
}

fn credentials(access_token: &str) -> StoredCredentials {
    StoredCredentials::new(
        "client-id".to_owned(),
        Some(token_response(access_token)),
        vec![],
        None,
    )
}

fn record(url: &str, enabled: bool, credentials: Option<StoredCredentials>) -> McpServerRecord {
    McpServerRecord {
        user_id: owner(),
        url: url.to_owned(),
        server_name: "Example".to_owned(),
        credentials,
        enabled,
    }
}

struct FixedStore(Vec<McpServerRecord>);

impl McpServerStore for FixedStore {
    type Err = std::convert::Infallible;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        unreachable!("resolution never writes")
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
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        Ok(self.0.clone())
    }
}

#[derive(Default)]
struct SpyInner {
    asked: Mutex<Vec<String>>,
}

impl McpCredentials for &SpyInner {
    async fn resolve(
        &self,
        _owner: &MacroUserIdStr<'static>,
        destination: &McpDestination,
    ) -> Result<UpstreamCall, EgressError> {
        match destination {
            McpDestination::Connected(slug) => {
                self.asked.lock().expect("lock").push(slug.to_string());
                Err(EgressError::UnknownServer(slug.clone()))
            }
            McpDestination::Macro | McpDestination::Custom(_) => {
                unreachable!(
                    "the decorator answers Custom itself; tests only pass through Connected"
                )
            }
        }
    }
}

const URL: &str = "https://mcp.example.com/mcp";

#[tokio::test]
async fn stamps_the_stored_access_token() {
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(
        &inner,
        FixedStore(vec![record(
            URL,
            true,
            Some(credentials("native-access-token")),
        )]),
    );
    let (_id, destination) = custom(URL);

    let call = credentials
        .resolve(&owner(), &destination)
        .await
        .expect("resolved");

    assert_eq!(call.url().as_str(), "https://mcp.example.com/mcp");
    assert_eq!(
        call.authorization()
            .header_value()
            .expect("header")
            .to_str()
            .expect("ascii"),
        "Bearer native-access-token"
    );
    assert!(inner.asked.lock().expect("lock").is_empty());
}

#[tokio::test]
async fn a_disabled_or_unauthenticated_row_is_unknown() {
    let inner = SpyInner::default();
    let (_id, destination) = custom(URL);

    for row in [
        record(URL, false, Some(credentials("token"))),
        record(URL, true, None),
        record(
            URL,
            true,
            Some(StoredCredentials::new(
                "client-id".to_owned(),
                None,
                vec![],
                None,
            )),
        ),
    ] {
        let credentials = WithCustomMcp::new(&inner, FixedStore(vec![row]));
        let refusal = credentials
            .resolve(&owner(), &destination)
            .await
            .expect_err("refused");
        assert!(
            matches!(refusal, EgressError::UnknownCustom(_)),
            "{refusal}"
        );
    }
}

#[tokio::test]
async fn an_unknown_id_is_unknown() {
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, FixedStore(Vec::new()));
    let (_id, destination) = custom(URL);

    let refusal = credentials
        .resolve(&owner(), &destination)
        .await
        .expect_err("refused");

    assert!(matches!(refusal, EgressError::UnknownCustom(_)));
}

#[tokio::test]
async fn refuses_a_cleartext_upstream() {
    let inner = SpyInner::default();
    let url = "http://mcp.example.com/mcp";
    let credentials = WithCustomMcp::new(
        &inner,
        FixedStore(vec![record(url, true, Some(credentials("token")))]),
    );
    let (_id, destination) = custom(url);

    let refusal = credentials
        .resolve(&owner(), &destination)
        .await
        .expect_err("refused");

    assert!(matches!(refusal, EgressError::InsecureUpstream(_)));
}

#[tokio::test]
async fn every_other_destination_delegates_to_the_inner_resolver() {
    let inner = SpyInner::default();
    let credentials = WithCustomMcp::new(&inner, FixedStore(Vec::new()));

    let refusal = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect_err("the spy refuses everything");

    assert!(matches!(refusal, EgressError::UnknownServer(_)));
    assert_eq!(*inner.asked.lock().expect("lock"), ["linear"]);
}
