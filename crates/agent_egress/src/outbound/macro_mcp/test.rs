use super::*;
use crate::domain::model::McpServerSlug;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@example.com").expect("a valid user id")
}

fn connected(slug: &str) -> McpDestination {
    McpDestination::Connected(McpServerSlug::parse(slug).expect("a valid slug"))
}

/// A syntactically valid JWT whose payload carries `exp`, and nothing else
/// real - `token_expiry` reads without verifying.
fn jwt_expiring_at(exp: i64) -> String {
    use base64::Engine;
    let encode = |bytes: &[u8]| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
    format!(
        "{}.{}.{}",
        encode(br#"{"alg":"RS256","kid":"macro"}"#),
        encode(format!(r#"{{"exp":{exp}}}"#).as_bytes()),
        encode(b"unverified"),
    )
}

/// Counts mints and answers with a fixed-expiry token.
struct CountingTokens {
    minted: AtomicUsize,
    expires_at: DateTime<Utc>,
}

impl CountingTokens {
    fn expiring_at(expires_at: DateTime<Utc>) -> Self {
        Self {
            minted: AtomicUsize::new(0),
            expires_at,
        }
    }

    fn fresh() -> Self {
        Self::expiring_at(Utc::now() + ChronoDuration::hours(1))
    }
}

impl MacroApiTokens for &CountingTokens {
    async fn mint(&self, _owner: &MacroUserIdStr<'static>) -> Result<String, EgressError> {
        let count = self.minted.fetch_add(1, Ordering::SeqCst) + 1;
        Ok(format!(
            "{}#{count}",
            jwt_expiring_at(self.expires_at.timestamp())
        ))
    }
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
    ) -> Result<UpstreamCall, EgressError> {
        let McpDestination::Connected(slug) = destination else {
            unreachable!("the decorator answers Macro's own destination itself");
        };
        self.asked.lock().expect("lock").push(slug.to_string());
        Err(EgressError::UnknownServer(slug.clone()))
    }
}

fn macro_url() -> Url {
    Url::parse("https://mcp.macro.com/mcp").expect("url")
}

#[tokio::test]
async fn answers_macros_own_destination_with_a_minted_token() {
    let tokens = CountingTokens::fresh();
    let inner = SpyInner::default();
    let credentials = WithMacroMcp::new(&inner, &tokens, macro_url(), false).expect("constructed");

    let call = credentials
        .resolve(&owner(), &McpDestination::Macro)
        .await
        .expect("resolved");

    assert_eq!(call.url().as_str(), "https://mcp.macro.com/mcp");
    assert!(
        inner.asked.lock().expect("lock").is_empty(),
        "Macro's own destination must never consult the owner's rows"
    );
}

/// The token is the owner's identity for its whole lifetime; re-minting per
/// request would spend an exchange round trip on every tool call.
#[tokio::test]
async fn reuses_a_token_until_it_nears_expiry() {
    let tokens = CountingTokens::fresh();
    let inner = SpyInner::default();
    let credentials = WithMacroMcp::new(&inner, &tokens, macro_url(), false).expect("constructed");

    for _ in 0..3 {
        credentials
            .resolve(&owner(), &McpDestination::Macro)
            .await
            .expect("resolved");
    }

    assert_eq!(tokens.minted.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_token_about_to_expire_is_replaced() {
    // Inside the margin from the start, so every resolve re-mints.
    let tokens = CountingTokens::expiring_at(Utc::now() + ChronoDuration::minutes(1));
    let inner = SpyInner::default();
    let credentials = WithMacroMcp::new(&inner, &tokens, macro_url(), false).expect("constructed");

    for _ in 0..2 {
        credentials
            .resolve(&owner(), &McpDestination::Macro)
            .await
            .expect("resolved");
    }

    assert_eq!(tokens.minted.load(Ordering::SeqCst), 2);
}

#[tokio::test]
async fn every_other_slug_delegates_to_the_inner_resolver() {
    let tokens = CountingTokens::fresh();
    let inner = SpyInner::default();
    let credentials = WithMacroMcp::new(&inner, &tokens, macro_url(), false).expect("constructed");

    let refusal = credentials
        .resolve(&owner(), &connected("linear"))
        .await
        .expect_err("the spy refuses everything");

    assert!(matches!(refusal, EgressError::UnknownServer(_)));
    assert_eq!(*inner.asked.lock().expect("lock"), ["linear"]);
    assert_eq!(tokens.minted.load(Ordering::SeqCst), 0);
}

/// A deployed environment pointing Macro's own MCP server at cleartext is
/// misconfigured; it must fail at boot, not at the first tool call.
#[tokio::test]
async fn refuses_a_cleartext_url_unless_local_dev_permits_it() {
    let tokens = CountingTokens::fresh();
    let url = Url::parse("http://mcp-service:8080/mcp").expect("url");

    let refusal = WithMacroMcp::new(&SpyInner::default(), &tokens, url.clone(), false)
        .err()
        .expect("refused");
    assert!(matches!(refusal, EgressError::InsecureUpstream(_)));

    let inner = SpyInner::default();
    let permitted = WithMacroMcp::new(&inner, &tokens, url, true).expect("constructed");
    let call = permitted
        .resolve(&owner(), &McpDestination::Macro)
        .await
        .expect("resolved");
    assert_eq!(call.url().as_str(), "http://mcp-service:8080/mcp");
}

#[test]
fn reads_the_expiry_off_a_minted_token() {
    let expires = Utc::now().timestamp() + 900;
    let expiry = token_expiry(&jwt_expiring_at(expires)).expect("readable");
    assert_eq!(expiry.timestamp(), expires);
}

#[test]
fn an_unreadable_token_is_an_upstream_error() {
    for garbage in ["", "not-a-jwt", "a.b.c", "a.!!!.c"] {
        let refusal = token_expiry(garbage).expect_err(garbage);
        assert!(matches!(refusal, EgressError::Upstream(_)), "{garbage}");
    }
}
