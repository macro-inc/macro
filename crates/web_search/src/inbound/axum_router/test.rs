use std::sync::{Arc, Mutex};

use ai_billing::{AiAdmissionError, AiAdmissionService, DenyReason, DisabledAiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageEvent, UsageRecorder};
use async_trait::async_trait;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState, ValidatedCredential,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitService,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::{WebRouterState, web_router};
use crate::domain::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebSearchResult,
};
use crate::domain::ports::SearchProvider;
use crate::domain::service::WebSearchService;

const USER_ID: &str = "macro|web-router@example.com";

#[derive(Default)]
struct FakeProvider {
    calls: Mutex<usize>,
}

#[async_trait]
impl SearchProvider for FakeProvider {
    fn pricing_model(&self) -> &'static str {
        "tavily"
    }

    async fn search(&self, _: &SearchQuery) -> Result<Billed<Vec<WebSearchResult>>, ProviderError> {
        *self.calls.lock().unwrap() += 1;
        Ok(Billed {
            credits: Some(1),
            value: vec![WebSearchResult {
                title: "Macro".into(),
                url: "https://macro.com/".into(),
                snippet: "Macro is a workspace.".into(),
                published_at: None,
                content: None,
            }],
        })
    }

    async fn fetch(&self, _: &PageRequest) -> Result<Billed<FetchedPage>, ProviderError> {
        *self.calls.lock().unwrap() += 1;
        Err(ProviderError::PageUnavailable(
            "Failed to retrieve content".into(),
        ))
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

struct Denied;

impl AiAdmissionService for Denied {
    fn admit<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
        _: AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        Box::pin(async { Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)) })
    }
}

#[derive(Clone, Default)]
struct FakeRateLimiter {
    exceeded: bool,
    checks: Arc<Mutex<Vec<(String, u64, u64)>>>,
}

impl RateLimitService for FakeRateLimiter {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        self.checks.lock().unwrap().push((
            key.to_hex_string(),
            config.max_count,
            config.window.as_secs(),
        ));
        if self.exceeded {
            return Ok(Err(RateLimitExceeded {
                current_count: config.max_count,
                max_count: config.max_count,
                retry_after: config.window,
            }));
        }
        Ok(Ok(RateLimitOk::new_testing_value(1, key, config)))
    }

    async fn rollback_ticket(&self, _: RateLimitOk) -> Result<(), Report> {
        Ok(())
    }
}

#[derive(Clone, Default)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "valid" => Ok(UserContext {
                user_id: USER_ID.to_owned(),
                ..UserContext::default()
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _: &str,
        _: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn router(
    provider: Arc<FakeProvider>,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<Recorder>,
    limiter: FakeRateLimiter,
) -> Router {
    web_router::<_, _, ()>(WebRouterState::new(
        Arc::new(WebSearchService::new(provider, admission, recorder)),
        limiter,
        MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    ))
}

fn post(uri: &str, authorization: Option<&str>, body: Value) -> Request<Body> {
    let mut request = Request::builder()
        .method("POST")
        .uri(uri)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(token) = authorization {
        request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
    }
    request.body(Body::from(body.to_string())).unwrap()
}

async fn json_body(response: axum::response::Response) -> Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

#[tokio::test]
async fn search_returns_results_and_meters_the_caller() {
    let provider = Arc::new(FakeProvider::default());
    let recorder = Arc::new(Recorder::default());
    let limiter = FakeRateLimiter::default();
    let response = router(
        provider.clone(),
        Arc::new(DisabledAiAdmissionService),
        recorder.clone(),
        limiter.clone(),
    )
    .oneshot(post(
        "/web/search",
        Some("valid"),
        json!({ "query": "what is macro", "maxResults": 1, "topic": "news" }),
    ))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        json_body(response).await,
        json!({ "results": [{
            "title": "Macro",
            "url": "https://macro.com/",
            "snippet": "Macro is a workspace."
        }] })
    );
    let checks = limiter.checks.lock().unwrap();
    assert_eq!(checks.len(), 1);
    assert_eq!((checks[0].1, checks[0].2), (600, 3600));
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].user.as_ref(), USER_ID);
    assert_eq!(events[0].feature, AiFeature::WebSearch);
    assert_eq!(events[0].model, "tavily");
    assert_eq!(
        events[0].amount,
        UsageAmount::ProviderCredits { credits: 1 }
    );
}

#[tokio::test]
async fn unauthenticated_requests_do_no_work() {
    let provider = Arc::new(FakeProvider::default());
    let limiter = FakeRateLimiter::default();
    let app = router(
        provider.clone(),
        Arc::new(DisabledAiAdmissionService),
        Arc::new(Recorder::default()),
        limiter.clone(),
    );

    for token in [None, Some("forged")] {
        let response = app
            .clone()
            .oneshot(post("/web/search", token, json!({ "query": "macro" })))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    }

    assert_eq!(*provider.calls.lock().unwrap(), 0);
    assert!(limiter.checks.lock().unwrap().is_empty());
}

#[tokio::test]
async fn admission_refusal_is_payment_required() {
    let provider = Arc::new(FakeProvider::default());
    let recorder = Arc::new(Recorder::default());
    let response = router(
        provider.clone(),
        Arc::new(Denied),
        recorder.clone(),
        FakeRateLimiter::default(),
    )
    .oneshot(post(
        "/web/search",
        Some("valid"),
        json!({ "query": "macro" }),
    ))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::PAYMENT_REQUIRED);
    assert_eq!(
        json_body(response).await["code"],
        DenyReason::AllowanceExhausted.code()
    );
    assert_eq!(*provider.calls.lock().unwrap(), 0);
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_hourly_limit_refuses_before_the_provider() {
    let provider = Arc::new(FakeProvider::default());
    let response = router(
        provider.clone(),
        Arc::new(DisabledAiAdmissionService),
        Arc::new(Recorder::default()),
        FakeRateLimiter {
            exceeded: true,
            ..FakeRateLimiter::default()
        },
    )
    .oneshot(post(
        "/web/fetch",
        Some("valid"),
        json!({ "url": "https://example.com/" }),
    ))
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(*provider.calls.lock().unwrap(), 0);
}

#[tokio::test]
async fn unreadable_pages_and_bad_input_have_distinct_codes() {
    let app = router(
        Arc::new(FakeProvider::default()),
        Arc::new(DisabledAiAdmissionService),
        Arc::new(Recorder::default()),
        FakeRateLimiter::default(),
    );

    let unreadable = app
        .clone()
        .oneshot(post(
            "/web/fetch",
            Some("valid"),
            json!({ "url": "https://example.com/members-only" }),
        ))
        .await
        .unwrap();
    assert_eq!(unreadable.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(
        json_body(unreadable).await,
        json!({
            "error": "The page could not be read: Failed to retrieve content",
            "code": "fetch_failed"
        })
    );

    let invalid = app
        .oneshot(post(
            "/web/fetch",
            Some("valid"),
            json!({ "url": "file:///etc/passwd" }),
        ))
        .await
        .unwrap();
    assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
    assert_eq!(json_body(invalid).await["code"], "invalid_request");
}
