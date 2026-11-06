use std::{
    collections::BTreeMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use axum::{
    Router,
    body::{Body, to_bytes},
    extract::FromRef,
    http::{Request, StatusCode, header},
    routing::post,
};
use hosted_runtimes::domain::{
    enrollment::PersonaConfigKey,
    persona_credentials::{PersonaCredentials, PersonaEnv},
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalIdentityClaims, MacroAuthorizationError,
    MacroAuthorizationState, ValidatedCredential,
};
use model::user::UserContext;
use rootcause::Report;
use tower::ServiceExt;

use super::*;

#[derive(Clone)]
struct Authorization;
impl MacroAuthorizationService for Authorization {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
    async fn authorize_identity(
        &self,
        _: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
    async fn authorize_internal(
        &self,
        key: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if key == "enrollment-test-internal" {
            Ok(None)
        } else {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }
}

struct Source {
    calls: AtomicUsize,
    error: Mutex<Option<PersonaCredentialError>>,
}
impl PersonaCredentialSource for Source {
    async fn issue(
        &self,
        _: ComputerId,
        _: EnrollmentGeneration,
    ) -> Result<PersonaEnrollment, PersonaCredentialError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if let Some(error) = self.error.lock().unwrap().take() {
            return Err(error);
        }
        Ok(PersonaEnrollment {
            secrets: PersonaCredentials::new(BTreeMap::from([
                (
                    PersonaConfigKey::parse("MACRO_API_KEY").unwrap(),
                    "enrollment-test-api".to_owned(),
                ),
                (
                    PersonaConfigKey::parse("ANTHROPIC_AUTH_TOKEN").unwrap(),
                    "enrollment-test-api".to_owned(),
                ),
                (
                    PersonaConfigKey::parse("MACRO_REPO_TOKEN").unwrap(),
                    "enrollment-test-repo".to_owned(),
                ),
            ]))
            .unwrap(),
            env: PersonaEnv::default(),
        })
    }
}

#[derive(Clone)]
struct State {
    source: Arc<Source>,
    authorization: MacroAuthorizationState<Authorization>,
}
impl FromRef<State> for Arc<Source> {
    fn from_ref(s: &State) -> Self {
        s.source.clone()
    }
}
impl FromRef<State> for MacroAuthorizationState<Authorization> {
    fn from_ref(s: &State) -> Self {
        s.authorization.clone()
    }
}
fn router(error: Option<PersonaCredentialError>) -> (Router, Arc<Source>) {
    let source = Arc::new(Source {
        calls: AtomicUsize::new(0),
        error: Mutex::new(error),
    });
    let state = State {
        source: source.clone(),
        authorization: MacroAuthorizationState::new(Arc::new(Authorization)),
    };
    (
        Router::new()
            .route(
                "/enrollment/{computer}/{generation}",
                post(handler::<Source, Authorization>),
            )
            .with_state(state),
        source,
    )
}
fn request(key: Option<&str>) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri("/enrollment/00000000-0000-0000-0000-000000000001/1");
    if let Some(key) = key {
        request = request.header(INTERNAL_API_KEY_HEADER, key);
    }
    request.body(Body::empty()).unwrap()
}

#[tokio::test]
async fn unauthorized_requests_never_issue_credentials() {
    for key in [None, Some("invalid-internal")] {
        let (router, source) = router(None);
        let response = router.oneshot(request(key)).await.unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(source.calls.load(Ordering::SeqCst), 0);
    }
}

#[tokio::test]
async fn internal_response_is_one_time_material_with_no_store() {
    let (router, source) = router(None);
    let response = router
        .oneshot(request(Some("enrollment-test-internal")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    let material: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(material["secrets"]["MACRO_API_KEY"], "enrollment-test-api");
    assert_eq!(
        material["secrets"]["ANTHROPIC_AUTH_TOKEN"],
        "enrollment-test-api"
    );
    assert_eq!(
        material["secrets"]["MACRO_REPO_TOKEN"],
        "enrollment-test-repo"
    );
    assert_eq!(source.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn issuance_errors_have_safe_http_statuses_and_no_secret_body() {
    for (error, expected) in [
        (PersonaCredentialError::NotFound, StatusCode::NOT_FOUND),
        (
            PersonaCredentialError::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            PersonaCredentialError::IssuanceFailed,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let (router, source) = router(Some(error));
        let response = router
            .oneshot(request(Some("enrollment-test-internal")))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert!(
            to_bytes(response.into_body(), 4096)
                .await
                .unwrap()
                .is_empty()
        );
        assert_eq!(source.calls.load(Ordering::SeqCst), 1);
    }
}
