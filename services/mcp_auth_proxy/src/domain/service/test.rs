use super::*;
use crate::domain::{
    models::{AccessToken, Email, OneTimeCode, RefreshToken, ResumeUri},
    ports::{
        PasswordlessCompleteFuture, PasswordlessStartFuture, ProductPasswordless, TokenPairFuture,
    },
};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

const VERIFIER: &str = "mcp-pkce-verifier-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CLIENT_REDIRECT: &str = "http://127.0.0.1:54321/callback";
const UPSTREAM_AUTHORIZE: &str = "https://auth.example/authorize";
const UPSTREAM_CODE: &str = "upstream-code";
const ACCESS: &str = "access-token";
const REFRESH: &str = "refresh-token";
const NEW_REFRESH: &str = "rotated-refresh-token";
const EMAIL: &str = "person@example.com";
const OTP: &str = "123456";
const DOMAIN_IDP: &str = "enterprise-idp";

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

fn email() -> Email {
    Email::parse(EMAIL).unwrap()
}

fn otp() -> OneTimeCode {
    OneTimeCode::parse(OTP).unwrap()
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
struct FakeOauth {
    authorizations: Mutex<Vec<UpstreamAuthorize>>,
}

impl OAuthProvider for FakeOauth {
    fn construct_authorize_url(&self, destination: &UpstreamAuthorize) -> anyhow::Result<String> {
        self.authorizations
            .lock()
            .unwrap()
            .push(destination.clone());
        let idp = match &destination.identity_provider {
            IdentityProvider::GoogleGmail => "google",
            IdentityProvider::DomainSso { idp_id } => idp_id,
        };
        let login_hint = destination
            .login_hint
            .as_ref()
            .map(Email::as_str)
            .unwrap_or_default();
        Ok(format!(
            "{UPSTREAM_AUTHORIZE}?state={}&idp={idp}&login_hint={login_hint}",
            destination.state
        ))
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

#[derive(Clone)]
enum StartBehavior {
    Sent,
    SsoRequired,
}

#[derive(Clone)]
enum CompleteBehavior {
    Success,
    InvalidOtp,
}

struct FakePasswordless {
    start_behavior: StartBehavior,
    complete_behavior: CompleteBehavior,
    starts: Mutex<Vec<StartPasswordless>>,
    completes: Mutex<Vec<CompletePasswordless>>,
}

impl FakePasswordless {
    fn new(start_behavior: StartBehavior, complete_behavior: CompleteBehavior) -> Self {
        Self {
            start_behavior,
            complete_behavior,
            starts: Mutex::new(Vec::new()),
            completes: Mutex::new(Vec::new()),
        }
    }
}

impl ProductPasswordless for FakePasswordless {
    fn start<'a>(&'a self, command: StartPasswordless) -> PasswordlessStartFuture<'a> {
        self.starts.lock().unwrap().push(command);
        let behavior = self.start_behavior.clone();
        Box::pin(async move {
            match behavior {
                StartBehavior::Sent => Ok(PasswordlessStartResult::Sent {
                    local_otp: Some(otp()),
                }),
                StartBehavior::SsoRequired => Ok(PasswordlessStartResult::SsoRequired {
                    idp_id: DOMAIN_IDP.into(),
                }),
            }
        })
    }

    fn complete<'a>(&'a self, command: CompletePasswordless) -> PasswordlessCompleteFuture<'a> {
        self.completes.lock().unwrap().push(command);
        let behavior = self.complete_behavior.clone();
        Box::pin(async move {
            match behavior {
                CompleteBehavior::Success => {
                    Ok((AccessToken::from(ACCESS), RefreshToken::from(REFRESH)))
                }
                CompleteBehavior::InvalidOtp => Err(PasswordlessCompleteError::InvalidOtp),
            }
        })
    }
}

struct Fixture {
    service: McpAuthProxyServiceImpl<MemoryStore>,
    store: Arc<MemoryStore>,
    oauth: Arc<FakeOauth>,
    passwordless: Arc<FakePasswordless>,
}

fn fixture(start: StartBehavior, complete: CompleteBehavior) -> Fixture {
    let store = Arc::new(MemoryStore::default());
    let oauth = Arc::new(FakeOauth::default());
    let passwordless = Arc::new(FakePasswordless::new(start, complete));
    let service = McpAuthProxyServiceImpl::new(
        "https://mcp.example".into(),
        Arc::clone(&store),
        oauth.clone(),
        passwordless.clone(),
    );
    Fixture {
        service,
        store,
        oauth,
        passwordless,
    }
}

fn sent_fixture() -> Fixture {
    fixture(StartBehavior::Sent, CompleteBehavior::Success)
}

async fn started(fixture: &Fixture) -> SessionId {
    match fixture
        .service
        .start_authorization(authorize_request())
        .await
        .unwrap()
    {
        AuthorizationStart::Login { session_id } => session_id,
    }
}

async fn started_google(fixture: &Fixture) -> SessionId {
    let session_id = started(fixture).await;
    let result = fixture
        .service
        .advance_login(&session_id, LoginAction::ChooseGoogle)
        .await
        .unwrap();
    assert!(matches!(result, LoginAdvance::Redirect(_)));
    session_id
}

async fn started_otp(fixture: &Fixture) -> SessionId {
    let session_id = started(fixture).await;
    fixture
        .service
        .advance_login(
            &session_id,
            LoginAction::SubmitEmail {
                email: email(),
                resume_uri: ResumeUri::broker_login("https://mcp.example", &session_id),
            },
        )
        .await
        .unwrap();
    session_id
}

async fn issued_by_google(fixture: &Fixture) -> String {
    let session_id = started_google(fixture).await;
    fixture
        .service
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(session_id.to_string()),
            error: None,
            error_description: None,
        })
        .await
        .unwrap()
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
    let err = sent_fixture()
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
    let err = sent_fixture()
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
    let err = sent_fixture()
        .service
        .start_authorization(params)
        .await
        .expect_err("http is only allowed on loopback");
    assert!(matches!(err, StartAuthorizationError::InvalidRedirectUri));
}

#[tokio::test]
async fn start_authorization_returns_login_and_stores_choosing_method() {
    let fixture = sent_fixture();
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
    assert_eq!(session.phase, LoginPhase::ChoosingMethod);
}

#[tokio::test]
async fn choose_google_writes_awaiting_upstream_and_returns_fusionauth_url() {
    let fixture = sent_fixture();
    let session_id = started(&fixture).await;
    let result = fixture
        .service
        .advance_login(&session_id, LoginAction::ChooseGoogle)
        .await
        .unwrap();
    let LoginAdvance::Redirect(redirect) = result else {
        panic!("Google login redirects to FusionAuth");
    };
    assert!(redirect.as_str().starts_with(UPSTREAM_AUTHORIZE));
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        session.phase,
        LoginPhase::AwaitingUpstream {
            identity_provider: IdentityProvider::GoogleGmail,
        }
    );
    let authorizations = fixture.oauth.authorizations.lock().unwrap();
    assert_eq!(authorizations.len(), 1);
    assert_eq!(authorizations[0].state, session_id);
    assert_eq!(
        authorizations[0].identity_provider,
        IdentityProvider::GoogleGmail
    );
    assert_eq!(authorizations[0].login_hint, None);
}

#[tokio::test]
async fn submit_email_sent_writes_awaiting_otp_and_shows_local_code() {
    let fixture = sent_fixture();
    let session_id = started(&fixture).await;
    let result = fixture
        .service
        .advance_login(
            &session_id,
            LoginAction::SubmitEmail {
                email: email(),
                resume_uri: ResumeUri::broker_login("https://mcp.example", &session_id),
            },
        )
        .await
        .unwrap();
    assert_eq!(
        result,
        LoginAdvance::Show(LoginSurface::EnterOtp {
            session_id: session_id.clone(),
            email: email(),
            local_otp: Some(otp()),
            error: None,
        })
    );
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(session.phase, LoginPhase::AwaitingOtp { email: email() });
}

#[tokio::test]
async fn submit_email_sso_required_redirects_with_domain_idp_and_login_hint() {
    let fixture = fixture(StartBehavior::SsoRequired, CompleteBehavior::Success);
    let session_id = started(&fixture).await;
    let result = fixture
        .service
        .advance_login(
            &session_id,
            LoginAction::SubmitEmail {
                email: email(),
                resume_uri: ResumeUri::broker_login("https://mcp.example", &session_id),
            },
        )
        .await
        .unwrap();
    assert!(matches!(result, LoginAdvance::Redirect(_)));
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        session.phase,
        LoginPhase::AwaitingUpstream {
            identity_provider: IdentityProvider::DomainSso {
                idp_id: DOMAIN_IDP.into(),
            },
        }
    );
    let authorizations = fixture.oauth.authorizations.lock().unwrap();
    assert_eq!(
        authorizations[0].identity_provider,
        IdentityProvider::DomainSso {
            idp_id: DOMAIN_IDP.into(),
        }
    );
    assert_eq!(authorizations[0].login_hint, Some(email()));
    assert!(fixture.passwordless.completes.lock().unwrap().is_empty());
}

#[tokio::test]
async fn submit_otp_success_issues_a_broker_code_that_token_exchange_accepts() {
    let fixture = sent_fixture();
    let session_id = started_otp(&fixture).await;
    let result = fixture
        .service
        .advance_login(&session_id, LoginAction::SubmitOtp(otp()))
        .await
        .unwrap();
    let LoginAdvance::Redirect(redirect) = result else {
        panic!("valid OTP redirects to the MCP client");
    };
    let tokens = fixture
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(broker_code(redirect.as_str())),
            code_verifier: Some(VERIFIER.into()),
            refresh_token: None,
            redirect_uri: Some(CLIENT_REDIRECT.into()),
            client_id: None,
        })
        .await
        .unwrap();
    assert_eq!(tokens.access_token.as_str(), ACCESS);
    assert_eq!(tokens.refresh_token.as_str(), REFRESH);
}

#[tokio::test]
async fn submit_otp_invalid_restores_awaiting_otp() {
    let fixture = fixture(StartBehavior::Sent, CompleteBehavior::InvalidOtp);
    let session_id = started_otp(&fixture).await;
    let result = fixture
        .service
        .advance_login(&session_id, LoginAction::SubmitOtp(otp()))
        .await
        .unwrap();
    assert_eq!(
        result,
        LoginAdvance::Show(LoginSurface::EnterOtp {
            session_id: session_id.clone(),
            email: email(),
            local_otp: None,
            error: Some(LoginPageError::InvalidOtp),
        })
    );
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .expect("invalid OTP restores the session");
    assert_eq!(session.phase, LoginPhase::AwaitingOtp { email: email() });
}

#[tokio::test]
async fn complete_callback_during_awaiting_otp_is_wrong_phase() {
    let fixture = sent_fixture();
    let session_id = started_otp(&fixture).await;
    let error = fixture
        .service
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(session_id.to_string()),
            error: None,
            error_description: None,
        })
        .await
        .expect_err("FusionAuth cannot complete an OTP session");
    assert!(matches!(error, CompleteCallbackError::WrongPhase));
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .expect("wrong-phase callback must restore the OTP session");
    assert_eq!(session.phase, LoginPhase::AwaitingOtp { email: email() });
}

#[tokio::test]
async fn back_returns_to_choose_method() {
    let fixture = sent_fixture();
    let session_id = started_otp(&fixture).await;
    let result = fixture
        .service
        .advance_login(&session_id, LoginAction::Back)
        .await
        .unwrap();
    assert_eq!(
        result,
        LoginAdvance::Show(LoginSurface::ChooseMethod {
            session_id: session_id.clone(),
        })
    );
    let session = fixture
        .store
        .load_session(&session_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(session.phase, LoginPhase::ChoosingMethod);
}

#[tokio::test]
async fn complete_callback_redirects_upstream_error_to_the_client() {
    let fixture = sent_fixture();
    let session_id = started_google(&fixture).await;
    let redirect = fixture
        .service
        .complete_callback(CallbackRequest {
            code: None,
            state: Some(session_id.to_string()),
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
    let fixture = sent_fixture();
    let session_id = started_google(&fixture).await;
    let redirect = fixture
        .service
        .complete_callback(CallbackRequest {
            code: Some(UPSTREAM_CODE.into()),
            state: Some(format!("\"{session_id}\"")),
            error: None,
            error_description: None,
        })
        .await
        .unwrap();
    let tokens = fixture
        .service
        .exchange_token(TokenRequest {
            grant_type: "authorization_code".into(),
            code: Some(broker_code(&redirect)),
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
    let fixture = sent_fixture();
    let redirect = issued_by_google(&fixture).await;
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
    let fixture = sent_fixture();
    let redirect = issued_by_google(&fixture).await;
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
    let tokens = sent_fixture()
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
