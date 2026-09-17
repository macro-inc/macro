use super::*;
use crate::domain::{DictationError, Transcript};
use axum::{
    body::{Body, to_bytes},
    http::{Request, header},
};
use bytes::Bytes;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rate_limit::domain::models::RateLimitOk;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const USER_ID: &str = "macro|dictation-test@example.com";
const INTERNAL_KEY: &str = "valid-internal-key";

/// `(user id, audio bytes, language hint)` as seen by the service.
type ServiceCall = (String, usize, Option<String>);

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Vec<ServiceCall>>>,
    response: Arc<Mutex<Option<Result<Transcript, DictationError>>>>,
}

impl FakeService {
    fn respond(&self, response: Result<Transcript, DictationError>) {
        *self.response.lock().unwrap() = Some(response);
    }

    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().unwrap().clone()
    }
}

impl DictationService for FakeService {
    async fn transcribe(
        &self,
        user: MacroUserIdStr<'static>,
        audio: Bytes,
        language: Option<LanguageHint>,
    ) -> Result<Transcript, DictationError> {
        self.calls.lock().unwrap().push((
            user.to_string(),
            audio.len(),
            language.map(|hint| hint.to_string()),
        ));
        self.response.lock().unwrap().take().unwrap_or_else(|| {
            Ok(Transcript {
                text: "hello".into(),
                duration_seconds: 1.0,
            })
        })
    }
}

#[derive(Clone, Default)]
struct FakeRateLimiter {
    exceeded: bool,
    checks: Arc<AtomicUsize>,
    rollbacks: Arc<AtomicUsize>,
}

impl RateLimitService for FakeRateLimiter {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.checks.fetch_add(1, Ordering::SeqCst);
        if self.exceeded {
            return Ok(Err(rate_limit::RateLimitExceeded {
                current_count: config.max_count,
                max_count: config.max_count,
                retry_after: config.window,
            }));
        }
        Ok(Ok(RateLimitOk::new_testing_value(1, key, config)))
    }

    async fn rollback_ticket(&self, _ticket: RateLimitOk) -> Result<(), Report> {
        self.rollbacks.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: USER_ID.to_owned(),
            ..UserContext::default()
        })
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            ..UserContext::default()
        }))
    }
}

struct Harness {
    service: FakeService,
    limiter: FakeRateLimiter,
}

impl Harness {
    fn new() -> Self {
        Self {
            service: FakeService::default(),
            limiter: FakeRateLimiter::default(),
        }
    }

    fn rate_limited() -> Self {
        Self {
            limiter: FakeRateLimiter {
                exceeded: true,
                ..FakeRateLimiter::default()
            },
            ..Self::new()
        }
    }

    fn router(&self) -> Router {
        dictation_router::<_, _, _, ()>(DictationRouterState::new(
            self.service.clone(),
            self.limiter.clone(),
            MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
        ))
    }

    async fn post(
        &self,
        uri: &str,
        headers: &[(header::HeaderName, &str)],
        body: impl Into<Body>,
    ) -> Response {
        let mut request = Request::builder().method("POST").uri(uri);
        for (name, value) in headers {
            request = request.header(name, *value);
        }
        self.router()
            .oneshot(request.body(body.into()).unwrap())
            .await
            .unwrap()
    }
}

async fn message(response: Response) -> String {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["message"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn transcribes_for_an_authenticated_user_and_forwards_language() {
    let harness = Harness::new();
    let response = harness
        .post(
            "/transcribe?language=en",
            &[(header::AUTHORIZATION, "Bearer valid")],
            "OggS-bytes",
        )
        .await;

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body: TranscribeResponse = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(body.text, "hello");
    assert_eq!(
        harness.service.calls(),
        [(USER_ID.to_owned(), 10, Some("en".to_owned()))]
    );
    assert_eq!(harness.limiter.checks.load(Ordering::SeqCst), 1);
    assert_eq!(harness.limiter.rollbacks.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejects_missing_and_invalid_credentials_before_any_work() {
    let harness = Harness::new();
    for headers in [&[][..], &[(header::AUTHORIZATION, "Bearer wrong")][..]] {
        let response = harness.post("/transcribe", headers, "audio").await;
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }
    assert!(harness.service.calls().is_empty());
    assert_eq!(harness.limiter.checks.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn rejects_internal_callers_because_dictation_is_user_only() {
    let harness = Harness::new();
    let response = harness
        .post(
            "/transcribe",
            &[
                (
                    header::HeaderName::from_static("x-internal-auth-key"),
                    INTERNAL_KEY,
                ),
                (
                    header::HeaderName::from_static("x-internal-macro-user-id"),
                    USER_ID,
                ),
            ],
            "audio",
        )
        .await;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(harness.service.calls().is_empty());
}

#[tokio::test]
async fn enforces_the_per_user_rate_limit() {
    let harness = Harness::rate_limited();
    let response = harness
        .post(
            "/transcribe",
            &[(header::AUTHORIZATION, "Bearer valid")],
            "audio",
        )
        .await;

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(harness.service.calls().is_empty());
}

#[tokio::test]
async fn rolls_back_the_rate_limit_ticket_when_the_service_fails() {
    let harness = Harness::new();
    harness.service.respond(Err(DictationError::Provider));
    let response = harness
        .post(
            "/transcribe",
            &[(header::AUTHORIZATION, "Bearer valid")],
            "audio",
        )
        .await;

    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(harness.limiter.rollbacks.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn maps_domain_errors_to_status_codes_without_leaking_content() {
    let cases = [
        (DictationError::InvalidSize, StatusCode::BAD_REQUEST),
        (
            DictationError::UnsupportedAudio,
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (DictationError::Busy, StatusCode::TOO_MANY_REQUESTS),
        (DictationError::Provider, StatusCode::BAD_GATEWAY),
    ];
    for (error, status) in cases {
        let harness = Harness::new();
        let expected = error.to_string();
        harness.service.respond(Err(error));
        let response = harness
            .post(
                "/transcribe",
                &[(header::AUTHORIZATION, "Bearer valid")],
                "audio",
            )
            .await;
        assert_eq!(response.status(), status);
        assert_eq!(message(response).await, expected);
    }
}

#[tokio::test]
async fn rejects_a_malformed_language_hint_in_the_adapter() {
    let harness = Harness::new();
    let response = harness
        .post(
            "/transcribe?language=en-US",
            &[(header::AUTHORIZATION, "Bearer valid")],
            "audio",
        )
        .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(harness.service.calls().is_empty());
}

#[tokio::test]
async fn rejects_bodies_over_the_recording_cap() {
    let harness = Harness::new();
    let response = harness
        .post(
            "/transcribe",
            &[(header::AUTHORIZATION, "Bearer valid")],
            vec![0u8; MAX_AUDIO_BYTES + 1],
        )
        .await;

    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    assert!(harness.service.calls().is_empty());
}
