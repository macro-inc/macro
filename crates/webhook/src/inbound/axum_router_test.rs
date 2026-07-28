use super::axum_router::{WebhookRouterState, webhook_router};
use crate::domain::{
    models::{
        CreateWebhookRequest, ListWebhooksResponse, PatchWebhookRequest, ValidateWebhookResponse,
        Webhook, WebhookId,
    },
    ports::{WebhookError, WebhookService},
};
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode, header},
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use rate_limit::{RateLimitConfig, RateLimitKey, RateLimitService};
use rootcause::Report;
use serde_json::json;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicUsize, Ordering},
};
use tower::ServiceExt;

const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Vec<ServiceCall>>>,
    response: Arc<Mutex<Option<Result<ServiceResponse, WebhookError>>>>,
}

#[derive(Debug)]
enum ServiceCall {
    Create(MacroUserIdStr<'static>, CreateWebhookRequest),
    Get(MacroUserIdStr<'static>, WebhookId),
    List(MacroUserIdStr<'static>),
    Patch(MacroUserIdStr<'static>, WebhookId, PatchWebhookRequest),
    Validate(MacroUserIdStr<'static>, WebhookId),
    Delete(MacroUserIdStr<'static>, WebhookId),
}

enum ServiceResponse {
    Webhook(Webhook),
    List(ListWebhooksResponse),
    Validate(ValidateWebhookResponse),
}

impl FakeService {
    fn set_response(&self, response: Result<ServiceResponse, WebhookError>) {
        *self.response.lock().unwrap() = Some(response);
    }

    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().unwrap().clone()
    }
}

impl Clone for ServiceCall {
    fn clone(&self) -> Self {
        match self {
            Self::Create(user, request) => Self::Create(user.clone(), request.clone()),
            Self::Get(user, id) => Self::Get(user.clone(), id.clone()),
            Self::List(user) => Self::List(user.clone()),
            Self::Patch(user, id, request) => {
                Self::Patch(user.clone(), id.clone(), request.clone())
            }
            Self::Validate(user, id) => Self::Validate(user.clone(), id.clone()),
            Self::Delete(user, id) => Self::Delete(user.clone(), id.clone()),
        }
    }
}

#[derive(Clone, Default)]
struct FakeAuthorizationService {
    calls: Arc<AtomicUsize>,
}

impl FakeAuthorizationService {
    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: user_id().to_string(),
            ..UserContext::default()
        })
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            organization_id: claims.organization_id,
            permissions: None,
        }))
    }
}

impl WebhookService for FakeService {
    async fn create_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        request: CreateWebhookRequest,
    ) -> Result<Webhook, WebhookError> {
        self.calls
            .lock()
            .unwrap()
            .push(ServiceCall::Create(caller, request));
        match self
            .response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Ok(ServiceResponse::Webhook(webhook())))?
        {
            ServiceResponse::Webhook(webhook) => Ok(webhook),
            _ => panic!("unexpected non-webhook response"),
        }
    }

    async fn get_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<Webhook, WebhookError> {
        self.calls
            .lock()
            .unwrap()
            .push(ServiceCall::Get(caller, webhook_id));
        match self
            .response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Ok(ServiceResponse::Webhook(webhook())))?
        {
            ServiceResponse::Webhook(webhook) => Ok(webhook),
            _ => panic!("unexpected non-webhook response"),
        }
    }

    async fn list_webhooks(
        &self,
        caller: MacroUserIdStr<'static>,
    ) -> Result<ListWebhooksResponse, WebhookError> {
        self.calls.lock().unwrap().push(ServiceCall::List(caller));
        match self.response.lock().unwrap().take().unwrap_or_else(|| {
            Ok(ServiceResponse::List(ListWebhooksResponse {
                webhooks: vec![webhook()],
            }))
        })? {
            ServiceResponse::List(response) => Ok(response),
            _ => panic!("unexpected non-list response"),
        }
    }

    async fn patch_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
        request: PatchWebhookRequest,
    ) -> Result<Webhook, WebhookError> {
        self.calls
            .lock()
            .unwrap()
            .push(ServiceCall::Patch(caller, webhook_id, request));
        match self
            .response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Ok(ServiceResponse::Webhook(webhook())))?
        {
            ServiceResponse::Webhook(webhook) => Ok(webhook),
            _ => panic!("unexpected non-webhook response"),
        }
    }

    async fn validate_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<ValidateWebhookResponse, WebhookError> {
        self.calls
            .lock()
            .unwrap()
            .push(ServiceCall::Validate(caller, webhook_id));
        match self
            .response
            .lock()
            .unwrap()
            .take()
            .unwrap_or_else(|| Ok(ServiceResponse::Validate(validate_response(true))))?
        {
            ServiceResponse::Validate(response) => Ok(response),
            _ => panic!("unexpected non-validate response"),
        }
    }

    async fn delete_webhook(
        &self,
        caller: MacroUserIdStr<'static>,
        webhook_id: WebhookId,
    ) -> Result<(), WebhookError> {
        self.calls
            .lock()
            .unwrap()
            .push(ServiceCall::Delete(caller, webhook_id));
        match self.response.lock().unwrap().take() {
            Some(Err(error)) => Err(error),
            _ => Ok(()),
        }
    }
}

#[derive(Clone, Default)]
struct FakeRateLimiter {
    exceeded: bool,
    checks: Arc<Mutex<usize>>,
    rollbacks: Arc<Mutex<usize>>,
}

impl FakeRateLimiter {
    fn exceeded() -> Self {
        Self {
            exceeded: true,
            ..Self::default()
        }
    }

    fn checks(&self) -> usize {
        *self.checks.lock().unwrap()
    }
}

impl RateLimitService for FakeRateLimiter {
    async fn check_rate_limit(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<rate_limit::RateLimitResult, rootcause::Report> {
        *self.checks.lock().unwrap() += 1;
        if self.exceeded {
            return Ok(Err(rate_limit::RateLimitExceeded {
                current_count: config.max_count,
                max_count: config.max_count,
                retry_after: config.window,
            }));
        }
        Ok(Ok(
            rate_limit::domain::models::RateLimitOk::new_testing_value(1, key, config),
        ))
    }

    async fn rollback_ticket(
        &self,
        _ticket: rate_limit::domain::models::RateLimitOk,
    ) -> Result<(), rootcause::Report> {
        *self.rollbacks.lock().unwrap() += 1;
        Ok(())
    }
}

#[tokio::test]
async fn create_passes_authenticated_user_and_body_to_service() {
    let service = FakeService::default();
    let response = send(
        service.clone(),
        FakeRateLimiter::default(),
        "POST",
        "/webhooks",
        create_body(),
    )
    .await;

    let status = response.status();
    let body = response_json(response).await;

    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["signing_secret"], "whsec_test");
    match &service.calls()[0] {
        ServiceCall::Create(user, request) => {
            assert_eq!(user.as_ref(), user_id());
            assert_eq!(request.name, "Events");
        }
        other => panic!("unexpected call: {other:?}"),
    }
}

#[tokio::test]
async fn patch_passes_authenticated_user_path_and_body_to_service() {
    let service = FakeService::default();
    let response = send(
        service.clone(),
        FakeRateLimiter::default(),
        "PATCH",
        "/webhooks/wh_123",
        json!({"name":"Renamed"}),
    )
    .await;

    let status = response.status();
    let body = response_json(response).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.get("signing_secret").is_none());
    match &service.calls()[0] {
        ServiceCall::Patch(user, webhook_id, request) => {
            assert_eq!(user.as_ref(), user_id());
            assert_eq!(webhook_id, "wh_123");
            assert_eq!(request.name.as_deref(), Some("Renamed"));
        }
        other => panic!("unexpected call: {other:?}"),
    }
}

#[tokio::test]
async fn get_passes_authenticated_user_and_path_to_service() {
    let service = FakeService::default();
    let response = send(
        service.clone(),
        FakeRateLimiter::default(),
        "GET",
        "/webhooks/wh_123",
        json!({}),
    )
    .await;

    let status = response.status();
    let body = response_json(response).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body.get("id").is_some());
    assert!(body.get("signing_secret").is_none());
    match &service.calls()[0] {
        ServiceCall::Get(user, webhook_id) => {
            assert_eq!(user.as_ref(), user_id());
            assert_eq!(webhook_id, "wh_123");
        }
        other => panic!("unexpected call: {other:?}"),
    }
}

#[tokio::test]
async fn list_passes_authenticated_user_to_service_and_is_not_rate_limited() {
    let service = FakeService::default();
    let limiter = FakeRateLimiter::exceeded();
    let response = send(
        service.clone(),
        limiter.clone(),
        "GET",
        "/webhooks",
        json!({}),
    )
    .await;

    let status = response.status();
    let body = response_json(response).await;

    assert_eq!(status, StatusCode::OK);
    assert!(body["webhooks"].is_array());
    assert_eq!(limiter.checks(), 0);
    match &service.calls()[0] {
        ServiceCall::List(user) => assert_eq!(user.as_ref(), user_id()),
        other => panic!("unexpected call: {other:?}"),
    }
}

#[tokio::test]
async fn validate_passes_authenticated_user_and_path_to_service() {
    let service = FakeService::default();
    let limiter = FakeRateLimiter::default();
    let authorization = FakeAuthorizationService::default();
    let response = send_request(
        service.clone(),
        limiter.clone(),
        authorization.clone(),
        Some("Bearer valid"),
        "POST",
        "/webhooks/wh_123/validate",
        json!({}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(authorization.calls(), 1);
    assert_eq!(limiter.checks(), 1);
    match &service.calls()[0] {
        ServiceCall::Validate(user, webhook_id) => {
            assert_eq!(user.as_ref(), user_id());
            assert_eq!(webhook_id, "wh_123");
        }
        other => panic!("unexpected call: {other:?}"),
    }
}

#[tokio::test]
async fn validate_remote_failure_returns_ok_and_consumes_rate_limit() {
    let service = FakeService::default();
    service.set_response(Ok(ServiceResponse::Validate(ValidateWebhookResponse {
        webhook_id: "wh_123".to_string(),
        is_valid: false,
        response_status: Some(500),
        message: Some("webhook returned HTTP 500".to_string()),
    })));
    let limiter = FakeRateLimiter::default();

    let response = send(
        service,
        limiter.clone(),
        "POST",
        "/webhooks/wh_123/validate",
        json!({}),
    )
    .await;
    let status = response.status();
    let body = response_json(response).await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["is_valid"], false);
    assert_eq!(body["message"], "webhook returned HTTP 500");
    assert_eq!(limiter.checks(), 1);
}

#[tokio::test]
async fn validation_rate_limit_exceeded_maps_to_429_and_skips_service() {
    let service = FakeService::default();
    let response = send(
        service.clone(),
        FakeRateLimiter::exceeded(),
        "POST",
        "/webhooks/wh_123/validate",
        json!({}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn missing_credentials_are_rejected_before_rate_limit_and_service_calls() {
    let service = FakeService::default();
    let limiter = FakeRateLimiter::default();
    let response = send_request(
        service.clone(),
        limiter.clone(),
        FakeAuthorizationService::default(),
        None,
        "POST",
        "/webhooks/wh_123/validate",
        json!({}),
    )
    .await;

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(limiter.checks(), 0);
    assert!(service.calls().is_empty());
}

#[tokio::test]
async fn create_patch_and_delete_are_not_rate_limited() {
    let service = FakeService::default();
    let limiter = FakeRateLimiter::exceeded();

    let create_response = send(
        service.clone(),
        limiter.clone(),
        "POST",
        "/webhooks",
        create_body(),
    )
    .await;
    let patch_response = send(
        service.clone(),
        limiter.clone(),
        "PATCH",
        "/webhooks/wh_123",
        json!({"name":"Renamed"}),
    )
    .await;
    let delete_response = send(
        service,
        limiter.clone(),
        "DELETE",
        "/webhooks/wh_123",
        json!({}),
    )
    .await;

    assert_eq!(create_response.status(), StatusCode::CREATED);
    assert_eq!(patch_response.status(), StatusCode::OK);
    assert_eq!(delete_response.status(), StatusCode::NO_CONTENT);
    assert_eq!(limiter.checks(), 0);
}

#[tokio::test]
async fn service_unauthorized_maps_to_403() {
    let service = FakeService::default();
    service.set_response(Err(WebhookError::Unauthorized));

    let response = send(
        service,
        FakeRateLimiter::default(),
        "POST",
        "/webhooks",
        create_body(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn bad_request_maps_to_400() {
    let service = FakeService::default();
    service.set_response(Err(WebhookError::BadRequest(
        "invalid endpoint".to_string(),
    )));

    let response = send(
        service,
        FakeRateLimiter::default(),
        "POST",
        "/webhooks",
        create_body(),
    )
    .await;

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

async fn send(
    service: FakeService,
    limiter: FakeRateLimiter,
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    send_request(
        service,
        limiter,
        FakeAuthorizationService::default(),
        Some("Bearer valid"),
        method,
        uri,
        body,
    )
    .await
}

async fn send_request(
    service: FakeService,
    limiter: FakeRateLimiter,
    authorization: FakeAuthorizationService,
    authorization_header: Option<&str>,
    method: &str,
    uri: &str,
    body: serde_json::Value,
) -> axum::response::Response {
    let authorization_state = MacroAuthorizationState::new(Arc::new(authorization));
    let router = webhook_router::<_, _, _, ()>(WebhookRouterState::new(
        service,
        limiter,
        authorization_state,
    ));
    let request = Request::builder()
        .method(method)
        .uri(uri)
        .header("content-type", "application/json");
    let request = match authorization_header {
        Some(value) => request.header(header::AUTHORIZATION, value),
        None => request,
    };

    router
        .oneshot(request.body(Body::from(body.to_string())).unwrap())
        .await
        .unwrap()
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn create_body() -> serde_json::Value {
    json!({
        "scope": "user",
        "name": "Events",
        "endpoint_url": "https://example.com/webhook",
        "headers": {"x-custom": "value"},
        "filters": [{"events": ["document.created"]}]
    })
}

fn validate_response(is_valid: bool) -> ValidateWebhookResponse {
    ValidateWebhookResponse {
        webhook_id: "wh_123".to_string(),
        is_valid,
        response_status: Some(200),
        message: None,
    }
}

fn webhook() -> Webhook {
    serde_json::from_value(json!({
        "id": "wh_123",
        "workspace_id": "workspace_1",
        "name": "Events",
        "endpoint_url": "https://example.com/webhook",
        "signing_secret": "whsec_test",
        "headers": {},
        "status": "active",
        "is_valid": false,
        "created_by_user_id": user_id(),
        "created_at": "2026-06-29T00:00:00Z",
        "updated_at": "2026-06-29T00:00:00Z",
        "deleted_at": null,
        "filters": [{"events": ["document.created"]}]
    }))
    .unwrap()
}

fn user_id() -> &'static str {
    "macro|webhook-test@example.com"
}
