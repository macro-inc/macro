use super::*;
use crate::domain::{
    models::{AccessToken, ProductTokens, RefreshToken},
    ports::TokenPairFuture,
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const VERIFIER: &str = "mcp-pkce-verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLIENT_REDIRECT: &str = "http://127.0.0.1:54321/callback";
const ACCESS: &str = "access-token";
const REFRESH: &str = "refresh-token";
const NEW_REFRESH: &str = "rotated-refresh-token";
const PRODUCT_APP: &str = "https://macro.example";

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

fn product_tokens() -> ProductTokens {
    ProductTokens {
        access_token: AccessToken::from(ACCESS),
        refresh_token: RefreshToken::from(REFRESH),
    }
}

#[derive(Default)]
struct MemoryStore {
    sessions: Mutex<HashMap<SessionId, AuthorizationSession>>,
    issued: Mutex<HashMap<String, IssuedAuthorizationCode>>,
}

impl InflightAuthStore for MemoryStore {
    fn insert_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.sessions
            .lock()
            .unwrap()
            .insert(session.id.clone(), session.clone());
        async { Ok(()) }
    }

    fn load_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send {
        let session = self.sessions.lock().unwrap().get(session_id).cloned();
        async move { Ok(session) }
    }

    fn replace_session(
        &self,
        session: &AuthorizationSession,
    ) -> impl Future<Output = anyhow::Result<()>> + Send {
        self.sessions
            .lock()
            .unwrap()
            .insert(session.id.clone(), session.clone());
        async { Ok(()) }
    }

    fn take_session(
        &self,
        session_id: &SessionId,
    ) -> impl Future<Output = anyhow::Result<Option<AuthorizationSession>>> + Send {
        let session = self.sessions.lock().unwrap().remove(session_id);
        async move { Ok(session) }
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

#[derive(Default)]
struct FakeOauth;

impl OAuthProvider for FakeOauth {
    fn refresh_access_token<'a>(&'a self, refresh_token: &'a RefreshToken) -> TokenPairFuture<'a> {
        Box::pin(async move {
            if refresh_token.as_str() != REFRESH {
                anyhow::bail!("unexpected refresh token");
            }
            Ok((AccessToken::from(ACCESS), RefreshToken::from(NEW_REFRESH)))
        })
    }
}

struct Fixture {
    service: McpAuthProxyServiceImpl<MemoryStore>,
    store: Arc<MemoryStore>,
}

fn fixture() -> Fixture {
    let store = Arc::new(MemoryStore::default());
    let service = McpAuthProxyServiceImpl::new(
        "https://mcp.example".into(),
        PRODUCT_APP.into(),
        Arc::clone(&store),
        Arc::new(FakeOauth),
    )
    .expect("product app URL is valid");
    Fixture { service, store }
}

async fn started(fixture: &Fixture) -> SessionId {
    match fixture
        .service
        .start_authorization(authorize_request())
        .await
        .unwrap()
    {
        AuthorizationStart::ProductLogin { redirect } => {
            let url = url::Url::parse(redirect.as_str()).unwrap();
            assert_eq!(url.origin().ascii_serialization(), PRODUCT_APP);
            assert_eq!(url.path(), "/login");
            SessionId::parse(
                url.query_pairs()
                    .find(|(key, _)| key == "mcp_session")
                    .unwrap()
                    .1
                    .as_ref(),
            )
            .unwrap()
        }
    }
}

async fn issued_by_product_login(fixture: &Fixture) -> String {
    let session_id = started(fixture).await;
    let completed = fixture
        .service
        .complete_login(&session_id, product_tokens())
        .await
        .unwrap();
    completed.redirect
}

fn broker_code(redirect: &str) -> String {
    redirect
        .strip_prefix(&format!("{CLIENT_REDIRECT}?code="))
        .and_then(|rest| rest.split('&').next())
        .expect("client redirect carries a broker code")
        .to_owned()
}

#[tokio::test]
async fn start_authorization_rejects_unsupported_response_type() {
    let mut params = authorize_request();
    params.response_type = "token".into();
    let err = fixture()
        .service
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
    let err = fixture()
        .service
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
    let err = fixture()
        .service
        .start_authorization(params)
        .await
        .expect_err("http is only allowed on loopback");
    assert!(matches!(err, StartAuthorizationError::InvalidRedirectUri));
}

#[tokio::test]
async fn new_rejects_an_unsafe_product_app_url() {
    let result = McpAuthProxyServiceImpl::new(
        "https://mcp.example".into(),
        "http://example.com".into(),
        Arc::new(MemoryStore::default()),
        Arc::new(FakeOauth),
    );
    assert!(
        matches!(result, Err(InvalidProductAppUrl)),
        "http product app URLs must be loopback"
    );
}

#[tokio::test]
async fn start_authorization_redirects_to_product_login_and_stores_the_session() {
    let fixture = fixture();
    let session_id = started(&fixture).await;
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .expect("authorization session is stored");
    assert_eq!(session.id, session_id);
    assert_eq!(session.client.client_state, "client-state");
    assert_eq!(session.client.client_redirect_uri, CLIENT_REDIRECT);
    assert_eq!(session.client.code_challenge, s256(VERIFIER));
}

#[tokio::test]
async fn complete_login_issues_a_broker_code_that_token_exchange_accepts() {
    let fixture = fixture();
    let session_id = started(&fixture).await;
    let completed = fixture
        .service
        .complete_login(&session_id, product_tokens())
        .await
        .unwrap();
    assert!(
        completed
            .redirect
            .starts_with(&format!("{CLIENT_REDIRECT}?code="))
    );
    assert!(completed.redirect.contains("state=client-state"));
    assert!(
        fixture
            .store
            .load_session(&session_id)
            .await
            .unwrap()
            .is_none(),
        "completing login consumes the session"
    );

    let tokens = fixture
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(broker_code(&completed.redirect)),
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
async fn complete_login_rejects_an_unknown_session() {
    let err = fixture()
        .service
        .complete_login(&SessionId::new(), product_tokens())
        .await
        .expect_err("unknown sessions cannot complete");
    assert!(matches!(err, CompleteLoginError::UnknownOrExpiredSession));
}

#[tokio::test]
async fn exchange_token_rejects_a_bad_pkce_verifier() {
    let fixture = fixture();
    let redirect = issued_by_product_login(&fixture).await;
    let err = fixture
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(broker_code(&redirect)),
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
    let fixture = fixture();
    let redirect = issued_by_product_login(&fixture).await;
    let err = fixture
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(broker_code(&redirect)),
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
    let tokens = fixture()
        .service
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
