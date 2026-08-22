use super::*;
use crate::domain::{
    models::{AccessToken, RefreshToken},
    ports::TokenPairFuture,
};
use std::collections::HashMap;
use std::sync::Mutex;

const VERIFIER: &str = "mcp-pkce-verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLIENT_REDIRECT: &str = "http://127.0.0.1:54321/callback";
const UPSTREAM_AUTHORIZE: &str = "https://auth.example/authorize";
const UPSTREAM_CODE: &str = "upstream-code";
const ACCESS: &str = "access-token";
const REFRESH: &str = "refresh-token";
const NEW_REFRESH: &str = "rotated-refresh-token";

fn s256(verifier: &str) -> String {
    let digest = Sha256::digest(verifier.as_bytes());
    URL_SAFE_NO_PAD.encode(digest)
}

fn authorize_request() -> AuthorizeRequest {
    AuthorizeRequest {
        response_type: "code".into(),
        client_id: "client".into(),
        redirect_uri: CLIENT_REDIRECT.into(),
        state: "client-state".into(),
        code_challenge: s256(VERIFIER),
        code_challenge_method: "S256".into(),
        scope: None,
    }
}

#[derive(Default)]
struct MemoryStore {
    pending: Mutex<HashMap<String, PendingAuthorization>>,
    issued: Mutex<HashMap<String, IssuedAuthorizationCode>>,
}

impl InflightAuthStore for MemoryStore {
    fn insert_pending(
        &self,
        session_id: &str,
        pending: PendingAuthorization,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.pending
            .lock()
            .unwrap()
            .insert(session_id.to_owned(), pending);
        async { Ok(()) }
    }

    fn take_pending(
        &self,
        session_id: &str,
    ) -> impl Future<Output = anyhow::Result<Option<PendingAuthorization>>> + Send {
        let pending = self.pending.lock().unwrap().remove(session_id);
        async move { Ok(pending) }
    }

    fn insert_issued(
        &self,
        code: &str,
        issued: IssuedAuthorizationCode,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.issued.lock().unwrap().insert(code.to_owned(), issued);
        async { Ok(()) }
    }

    fn take_issued(
        &self,
        code: &str,
    ) -> impl Future<Output = anyhow::Result<Option<IssuedAuthorizationCode>>> + Send {
        let issued = self.issued.lock().unwrap().remove(code);
        async move { Ok(issued) }
    }

    fn cleanup_expired(&self) -> impl Future<Output = anyhow::Result<()>> + Send {
        async { Ok(()) }
    }
}

struct FakeOauth;

impl OAuthProvider for FakeOauth {
    fn construct_authorize_url(&self, state: &str) -> anyhow::Result<String> {
        Ok(format!("{UPSTREAM_AUTHORIZE}?state={state}"))
    }

    fn exchange_authorization_code<'a>(&'a self, code: &'a str) -> TokenPairFuture<'a> {
        Box::pin(async move {
            if code != UPSTREAM_CODE {
                anyhow::bail!("unexpected upstream code");
            }
            Ok((AccessToken::from(ACCESS), RefreshToken::from(REFRESH)))
        })
    }

    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a> {
        Box::pin(async move {
            if refresh_token.as_str() != REFRESH {
                anyhow::bail!("unexpected refresh token");
            }
            Ok((AccessToken::from(ACCESS), RefreshToken::from(NEW_REFRESH)))
        })
    }
}

fn service() -> McpAuthProxyServiceImpl<MemoryStore> {
    McpAuthProxyServiceImpl::new(
        "https://mcp.example".into(),
        Arc::new(MemoryStore::default()),
        Arc::new(FakeOauth),
    )
}

async fn started() -> (McpAuthProxyServiceImpl<MemoryStore>, String) {
    let svc = service();
    let url = svc.start_authorization(authorize_request()).await.unwrap();
    let session_id = url
        .strip_prefix(&format!("{UPSTREAM_AUTHORIZE}?state="))
        .expect("authorize url keeps the session in state")
        .to_owned();
    (svc, session_id)
}

#[tokio::test]
async fn start_authorization_rejects_unsupported_response_type() {
    let mut params = authorize_request();
    params.response_type = "token".into();
    let err = service()
        .start_authorization(params)
        .await
        .expect_err("token response_type is unsupported");
    assert!(matches!(
        err,
        StartAuthorizationError::UnsupportedResponseType
    ));
}

#[tokio::test]
async fn start_authorization_rejects_plain_pkce() {
    let mut params = authorize_request();
    params.code_challenge_method = "plain".into();
    let err = service()
        .start_authorization(params)
        .await
        .expect_err("only S256 is supported");
    assert!(matches!(
        err,
        StartAuthorizationError::UnsupportedCodeChallengeMethod
    ));
}

#[tokio::test]
async fn start_authorization_rejects_non_loopback_http() {
    let mut params = authorize_request();
    params.redirect_uri = "http://example.com/callback".into();
    let err = service()
        .start_authorization(params)
        .await
        .expect_err("http is only allowed on loopback");
    assert!(matches!(err, StartAuthorizationError::InvalidRedirectUri));
}

#[tokio::test]
async fn start_authorization_stores_pending_and_returns_upstream_url() {
    let (svc, session_id) = started().await;
    let pending = svc
        .inflight_auth
        .take_pending(&session_id)
        .await
        .unwrap()
        .expect("pending session is stored");
    assert_eq!(pending.client_state, "client-state");
    assert_eq!(pending.client_redirect_uri, CLIENT_REDIRECT);
    assert_eq!(pending.code_challenge, s256(VERIFIER));
}

#[tokio::test]
async fn complete_callback_redirects_upstream_error_to_the_client() {
    let (svc, session_id) = started().await;
    let redirect = svc
        .complete_callback(CallbackRequest {
            code: None,
            state: Some(session_id),
            error: Some("access_denied".into()),
            error_description: Some("user cancelled".into()),
        })
        .await
        .unwrap();
    assert!(redirect.starts_with(&format!("{CLIENT_REDIRECT}?error=access_denied")));
    assert!(redirect.contains("state=client-state"));
    assert!(redirect.contains("error_description=user%20cancelled"));
}

#[tokio::test]
async fn complete_callback_issues_a_broker_code_for_the_client() {
    let (svc, session_id) = started().await;
    let redirect = svc
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(format!("\"{session_id}\"")),
            error: None,
            error_description: None,
        })
        .await
        .unwrap();
    let issued_code = redirect
        .strip_prefix(&format!("{CLIENT_REDIRECT}?code="))
        .and_then(|rest| rest.split('&').next())
        .expect("client redirect carries a broker code");
    let tokens = svc
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(issued_code.to_owned()),
            code_verifier: Some(VERIFIER.into()),
            refresh_token: None,
            redirect_uri: Some(CLIENT_REDIRECT.into()),
            client_id: None,
        })
        .await
        .unwrap();
    assert_eq!(tokens.access_token.as_str(), ACCESS);
    assert_eq!(tokens.refresh_token.as_str(), REFRESH);
    assert_eq!(tokens.token_type, "Bearer");
}

#[tokio::test]
async fn exchange_token_rejects_a_bad_pkce_verifier() {
    let (svc, session_id) = started().await;
    let redirect = svc
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(session_id),
            error: None,
            error_description: None,
        })
        .await
        .unwrap();
    let issued_code = redirect
        .strip_prefix(&format!("{CLIENT_REDIRECT}?code="))
        .and_then(|rest| rest.split('&').next())
        .unwrap();
    let err = svc
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(issued_code.to_owned()),
            code_verifier: Some("wrong-verifier".into()),
            refresh_token: None,
            redirect_uri: Some(CLIENT_REDIRECT.into()),
            client_id: None,
        })
        .await
        .expect_err("wrong verifier fails PKCE");
    assert!(matches!(err, TokenExchangeError::PkceVerificationFailed));
}

#[tokio::test]
async fn exchange_token_rejects_a_redirect_mismatch() {
    let (svc, session_id) = started().await;
    let redirect = svc
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(session_id),
            error: None,
            error_description: None,
        })
        .await
        .unwrap();
    let issued_code = redirect
        .strip_prefix(&format!("{CLIENT_REDIRECT}?code="))
        .and_then(|rest| rest.split('&').next())
        .unwrap();
    let err = svc
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(issued_code.to_owned()),
            code_verifier: Some(VERIFIER.into()),
            refresh_token: None,
            redirect_uri: Some("http://127.0.0.1:9/other".into()),
            client_id: None,
        })
        .await
        .expect_err("redirect must match the authorize request");
    assert!(matches!(err, TokenExchangeError::RedirectUriMismatch));
}

#[tokio::test]
async fn refresh_token_grant_rotates_the_refresh_token() {
    let tokens = service()
        .exchange_token(TokenRequest {
            grant_type: "refresh_token".into(),
            code: None,
            code_verifier: None,
            refresh_token: Some(RefreshToken::from(REFRESH)),
            redirect_uri: None,
            client_id: None,
        })
        .await
        .unwrap();
    assert_eq!(tokens.access_token.as_str(), ACCESS);
    assert_eq!(tokens.refresh_token.as_str(), NEW_REFRESH);
}
