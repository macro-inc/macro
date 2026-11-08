use super::*;
use crate::domain::models::MacroUserIdStr;
use macro_user_id::cowlike::CowLike;
use rmcp::transport::auth::OAuthTokenResponse;

/// A store nothing here should ever reach: every case below is answered
/// from the record alone.
struct UntouchedStore;

impl McpServerStore for UntouchedStore {
    type Err = anyhow::Error;

    async fn save(&self, _record: &McpServerRecord) -> Result<(), Self::Err> {
        unreachable!("a fresh or absent grant is never persisted")
    }

    async fn load(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<Option<McpServerRecord>, Self::Err> {
        unreachable!()
    }

    async fn delete(
        &self,
        _user_id: &MacroUserIdStr<'static>,
        _server_url: &str,
    ) -> Result<(), Self::Err> {
        unreachable!()
    }

    async fn list(
        &self,
        _user_id: &MacroUserIdStr<'static>,
    ) -> Result<Vec<McpServerRecord>, Self::Err> {
        unreachable!()
    }
}

fn record(credentials: Option<StoredCredentials>) -> McpServerRecord {
    McpServerRecord {
        user_id: MacroUserIdStr::parse_from_str("macro|owner@example.com")
            .unwrap()
            .into_owned(),
        url: "https://mcp.example.com/mcp".to_owned(),
        server_name: "Example".to_owned(),
        credentials,
        enabled: true,
    }
}

fn token(access_token: &str, expires_in: Option<u64>) -> OAuthTokenResponse {
    let mut response = serde_json::json!({
        "access_token": access_token,
        "token_type": "bearer",
    });
    if let Some(expires_in) = expires_in {
        response["expires_in"] = expires_in.into();
    }
    serde_json::from_value(response).expect("a token response")
}

fn credentials(token: Option<OAuthTokenResponse>, received_at: Option<u64>) -> StoredCredentials {
    StoredCredentials::new("client-id".to_owned(), token, Vec::new(), received_at)
}

#[test]
fn a_token_with_time_left_is_handed_out() {
    let stored = credentials(Some(token("live", Some(3600))), Some(1_000));
    assert_eq!(
        unexpired_access_token(&stored, 1_000 + 3600 - REFRESH_BUFFER_SECS),
        Some("live".to_owned())
    );
}

#[test]
fn a_token_inside_the_refresh_buffer_is_not() {
    let stored = credentials(Some(token("stale", Some(3600))), Some(1_000));
    assert_eq!(
        unexpired_access_token(&stored, 1_000 + 3600 - REFRESH_BUFFER_SECS + 1),
        None
    );
    assert_eq!(unexpired_access_token(&stored, 1_000 + 7200), None);
}

/// Credentials stored before expiry was tracked carry no `expires_in` or
/// `token_received_at`; there is nothing to compare, so the token stands.
#[test]
fn a_token_of_unknown_expiry_is_handed_out() {
    let no_expiry = credentials(Some(token("eternal", None)), Some(1_000));
    assert_eq!(
        unexpired_access_token(&no_expiry, u64::MAX),
        Some("eternal".to_owned())
    );
    let no_receipt = credentials(Some(token("undated", Some(60))), None);
    assert_eq!(
        unexpired_access_token(&no_receipt, u64::MAX),
        Some("undated".to_owned())
    );
}

#[test]
fn no_token_response_yields_nothing() {
    assert_eq!(unexpired_access_token(&credentials(None, Some(1)), 1), None);
}

#[tokio::test]
async fn a_server_added_without_an_account_is_anonymous() {
    let access = server_access(&record(None), Arc::new(UntouchedStore))
        .await
        .unwrap();
    assert_eq!(access, ServerAccess::Anonymous);
}

#[tokio::test]
async fn an_authorization_that_never_finished_requires_one() {
    let access = server_access(
        &record(Some(credentials(None, Some(1)))),
        Arc::new(UntouchedStore),
    )
    .await
    .unwrap();
    assert_eq!(access, ServerAccess::AuthorizationRequired);
}

/// A live token comes straight off the record: no discovery, no refresh,
/// nothing written.
#[tokio::test]
async fn a_live_token_is_returned_without_touching_the_network() {
    let now = now_epoch_secs();
    let access = server_access(
        &record(Some(credentials(
            Some(token("live", Some(3600))),
            Some(now),
        ))),
        Arc::new(UntouchedStore),
    )
    .await
    .unwrap();
    assert_eq!(access, ServerAccess::Bearer("live".to_owned()));
}

#[test]
fn debug_redacts_the_bearer() {
    assert_eq!(
        format!("{:?}", ServerAccess::Bearer("secret".to_owned())),
        "Bearer([REDACTED])"
    );
}
