use super::*;
use axum::body::{Body, to_bytes};
use axum::http::Request;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use rootcause::Report;
use serde_json::{Value, json};
use std::sync::Mutex;
use tower::ServiceExt;

const USER: &str = "macro|mentioner@example.com";
const KEY: &str = "user-executions-test-key";

#[derive(Clone)]
struct UserCredentials;

impl JwtValidator for UserCredentials {
    fn validate_credential(
        &self,
        _: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                user_id: USER.into(),
                fusion_user_id: "fusion-mentioner".into(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

/// Who credentials were issued for, and what ran with them.
#[derive(Debug, PartialEq)]
struct Seen {
    user: String,
    mention: Uuid,
    token: String,
    source: String,
    timeout_ms: u64,
}

#[derive(Default)]
struct Spy {
    issued: Mutex<Vec<(String, Uuid)>>,
    ran: Mutex<Vec<(String, String, u64)>>,
}

impl Spy {
    fn seen(&self) -> Vec<Seen> {
        self.issued
            .lock()
            .unwrap()
            .iter()
            .zip(self.ran.lock().unwrap().iter())
            .map(|((user, mention), (token, source, timeout_ms))| Seen {
                user: user.clone(),
                mention: *mention,
                token: token.clone(),
                source: source.clone(),
                timeout_ms: *timeout_ms,
            })
            .collect()
    }
}

#[async_trait::async_trait]
impl MentionExecutionCredentials for Spy {
    async fn issue(
        &self,
        user: &MacroUserIdStr<'static>,
        mention: Uuid,
    ) -> Result<RunEnvironment, CodeModeError> {
        self.issued
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), mention));
        Ok(RunEnvironment {
            token: "mention-signed-token".into(),
            trace_headers: Default::default(),
            session_id: None,
            execution_id: None,
            endpoints: Default::default(),
            unattended: None,
        })
    }
}

#[async_trait::async_trait]
impl ProgramExecutor for Spy {
    async fn execute_program(
        &self,
        request: ExecuteRequest,
        environment: RunEnvironment,
        _: CancellationToken,
    ) -> code_execution::domain::Outcome {
        self.ran.lock().unwrap().push((
            environment.token,
            request.source,
            request.timeout_ms,
        ));
        code_execution::domain::Outcome::Succeeded {
            value: json!({"data": 1}),
        }
    }
}

fn app(spy: Arc<Spy>) -> Router {
    user_executions_router(UserExecutionsState::new(
        spy.clone(),
        spy,
        MacroAuthorizationState::new(Arc::new(MacroAuthorizationServiceImpl::new(
            UserCredentials,
            InternalAuthConfig {
                api_key: KEY.into(),
                default_user_id: None,
            },
            NoBotAuthorizer,
            NoUserApiKeyAuthorizer,
        ))),
    ))
}

fn command() -> Value {
    json!({
        "userId": USER,
        "mention": {
            "messageId": "0195f0a0-0000-7000-8000-000000000001",
            "rootId": "0195f0a0-0000-7000-8000-000000000002",
        },
        "source": "export async function main() { return {data: 1}; }",
        "timeoutMs": 5000,
    })
}

fn request(body: Value, header: Option<(&str, &str)>) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(USER_EXECUTIONS_PATH)
        .header("content-type", "application/json");
    if let Some((name, value)) = header {
        request = request.header(name, value);
    }
    request.body(Body::from(body.to_string())).unwrap()
}

#[tokio::test]
async fn runs_as_the_named_user_with_mention_signed_credentials() {
    let spy = Arc::new(Spy::default());
    let response = app(spy.clone())
        .oneshot(request(command(), Some((INTERNAL_API_KEY_HEADER, KEY))))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    assert_eq!(body["result"], json!({"data": 1}));
    assert_eq!(
        spy.seen(),
        vec![Seen {
            user: USER.into(),
            mention: Uuid::parse_str("0195f0a0-0000-7000-8000-000000000001").unwrap(),
            token: "mention-signed-token".into(),
            source: "export async function main() { return {data: 1}; }".into(),
            timeout_ms: 5000,
        }]
    );
}

#[tokio::test]
async fn only_the_internal_key_is_admitted() {
    let spy = Arc::new(Spy::default());
    for (header, expected) in [
        (None, StatusCode::UNAUTHORIZED),
        (
            Some((INTERNAL_API_KEY_HEADER, "wrong")),
            StatusCode::UNAUTHORIZED,
        ),
        (
            Some(("authorization", "Bearer user")),
            StatusCode::FORBIDDEN,
        ),
    ] {
        let response = app(spy.clone())
            .oneshot(request(command(), header))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    assert!(spy.seen().is_empty());
}

#[tokio::test]
async fn a_caller_cannot_pick_the_agent_or_a_session() {
    let spy = Arc::new(Spy::default());
    for extra in [
        ("botId", json!("0195f0a0-0000-7000-8000-000000000003")),
        ("session", json!("0195f0a0-0000-7000-8000-000000000004")),
    ] {
        let mut body = command();
        body[extra.0] = extra.1;
        let response = app(spy.clone())
            .oneshot(request(body, Some((INTERNAL_API_KEY_HEADER, KEY))))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
    assert!(spy.seen().is_empty());
}
