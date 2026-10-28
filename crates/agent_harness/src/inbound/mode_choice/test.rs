use std::sync::Arc;

use axum::body::{Body, to_bytes};
use axum::http::{Request, StatusCode};
use jev::domain::JevError;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rootcause::Report;
use tower::ServiceExt as _;

use super::*;

const USER_ID: &str = "macro|mode-chooser@example.com";

/// Admits the one token `valid`, as the user above.
#[derive(Clone)]
struct TestAuthorizationService;

impl MacroAuthorizationService for TestAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_owned(),
            fusion_user_id: "fusion-mode-chooser".to_owned(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// A canned choice that records who asked about which prompt.
struct StubChoice {
    result: Result<AgentMode, ModeChoiceError>,
    asked: std::sync::Mutex<Vec<(String, String)>>,
}

#[async_trait::async_trait]
impl ModeChoiceService for StubChoice {
    async fn choose(
        &self,
        owner: MacroUserIdStr<'static>,
        prompt: &str,
    ) -> Result<AgentMode, ModeChoiceError> {
        self.asked
            .lock()
            .expect("stub poisoned")
            .push((owner.to_string(), prompt.to_owned()));
        self.result
    }
}

fn router(result: Result<AgentMode, ModeChoiceError>) -> (Router, Arc<StubChoice>) {
    let choice = Arc::new(StubChoice {
        result,
        asked: std::sync::Mutex::new(Vec::new()),
    });
    let state = AgentModeChoiceRouterState::new(
        Arc::clone(&choice) as Arc<dyn ModeChoiceService>,
        MacroAuthorizationState::new(Arc::new(TestAuthorizationService)),
    );
    (agent_mode_choice_router(state), choice)
}

fn request(token: Option<&str>, prompt: &str) -> Request<Body> {
    let builder = Request::builder()
        .uri("/agent-mode-choice")
        .method("POST")
        .header("content-type", "application/json");
    let builder = match token {
        Some(token) => builder.header("authorization", format!("Bearer {token}")),
        None => builder,
    };
    builder
        .body(Body::from(
            serde_json::json!({ "prompt": prompt }).to_string(),
        ))
        .unwrap()
}

#[tokio::test]
async fn answers_the_mode_for_the_callers_prompt() {
    let (router, choice) = router(Ok(AgentMode::Code));

    let response = router
        .oneshot(request(Some("valid"), "Fix the login bug"))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!({ "mode": "code" })
    );
    assert_eq!(
        *choice.asked.lock().unwrap(),
        [(USER_ID.to_owned(), "Fix the login bug".to_owned())]
    );
}

#[tokio::test]
async fn unauthenticated_callers_are_not_classified() {
    let (router, choice) = router(Ok(AgentMode::Chat));

    let response = router.oneshot(request(None, "Hello")).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(choice.asked.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failures_map_to_their_status() {
    for (error, status) in [
        (ModeChoiceError::EmptyPrompt, StatusCode::BAD_REQUEST),
        (ModeChoiceError::NotEnabled, StatusCode::FORBIDDEN),
        (
            ModeChoiceError::Admission(ai_billing::AiAdmissionError::Unavailable),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            ModeChoiceError::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (ModeChoiceError::Timeout, StatusCode::SERVICE_UNAVAILABLE),
        (
            ModeChoiceError::Classifier(JevError::Rejected),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let (router, _) = router(Err(error));

        let response = router.oneshot(request(Some("valid"), "x")).await.unwrap();

        assert_eq!(response.status(), status, "{error:?}");
    }
}
