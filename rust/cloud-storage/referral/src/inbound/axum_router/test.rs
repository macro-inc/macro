use std::net::SocketAddr;
use std::sync::Arc;

use axum::{Extension, extract::ConnectInfo, http::StatusCode};
use http_body_util::BodyExt;
use model_user::UserContext;
use rate_limit::{
    RateLimitConfig, RateLimitExceeded, RateLimitKey, RateLimitResult, RateLimitServiceImpl,
    domain::models::RateLimitOk,
};
use rootcause::Report;
use tower::ServiceExt;

use crate::domain::models::{ReferralCode, ReferralError};
use crate::domain::ports::ReferralService;
use crate::inbound::axum_router::{ReferralRouterState, referral_router};

struct MockReferralService {
    result: Result<ReferralCode, ReferralError>,
}

impl ReferralService for MockReferralService {
    async fn get_referral_code_for_user<'a>(
        &self,
        _user_id: &macro_user_id::user_id::MacroUserId<macro_user_id::lowercased::Lowercase<'a>>,
    ) -> Result<ReferralCode, ReferralError> {
        match &self.result {
            Ok(code) => Ok(code.clone()),
            Err(_) => Err(ReferralError::Internal(anyhow::anyhow!("mock error"))),
        }
    }

    async fn track_referral<'a>(
        &self,
        _referred_user_id: &macro_user_id::user_id::MacroUserId<
            macro_user_id::lowercased::Lowercase<'a>,
        >,
        _referral_code: &ReferralCode,
    ) -> Result<(), ReferralError> {
        Ok(())
    }

    async fn get_referred_by(
        &self,
        _referred_user_id: &uuid::Uuid,
    ) -> Result<Option<ReferralCode>, ReferralError> {
        Ok(None)
    }

    async fn process_referral<'a>(
        &self,
        _referred_user_id: &macro_user_id::user_id::MacroUserId<
            macro_user_id::lowercased::Lowercase<'a>,
        >,
        _referral_code: &ReferralCode,
    ) -> Result<(), ReferralError> {
        Ok(())
    }

    async fn send_referral_invite(
        &self,
        _sending_user: macro_user_id::user_id::MacroUserIdStr<'_>,
        _recipient: macro_user_id::email::EmailStr<'static>,
    ) -> Result<(), ReferralError> {
        Ok(())
    }
}

#[derive(Clone)]
struct MockRateLimitPort {
    should_exceed: bool,
}

impl rate_limit::RateLimitPort for MockRateLimitPort {
    async fn check(
        &self,
        key: RateLimitKey,
        config: RateLimitConfig,
    ) -> Result<RateLimitResult, Report> {
        if self.should_exceed {
            Ok(Err(RateLimitExceeded {
                current_count: config.max_count.saturating_add(1),
                max_count: config.max_count,
                retry_after: config.window,
            }))
        } else {
            Ok(Ok(RateLimitOk::new_testing_value(0, key, config)))
        }
    }

    async fn decrement(&self, _key: &RateLimitKey) -> Result<(), Report> {
        Ok(())
    }
}

fn allowing_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: false,
        },
    }
}

fn exceeding_rate_limiter() -> RateLimitServiceImpl<MockRateLimitPort> {
    RateLimitServiceImpl {
        repo: MockRateLimitPort {
            should_exceed: true,
        },
    }
}

fn test_user_context() -> UserContext {
    UserContext {
        user_id: "macro|test@test.com".to_string(),
        fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
        permissions: None,
        organization_id: None,
    }
}

fn build_router(
    service: MockReferralService,
    rate_limiter: RateLimitServiceImpl<MockRateLimitPort>,
) -> axum::Router {
    let state = ReferralRouterState {
        service: Arc::new(service),
        rate_limiter,
    };
    referral_router(state)
        .layer(Extension(ConnectInfo(SocketAddr::from((
            [127, 0, 0, 1],
            0,
        )))))
        .layer(Extension(test_user_context()))
}

fn ok_service() -> MockReferralService {
    MockReferralService {
        result: Ok(ReferralCode("test-code".to_string())),
    }
}

#[tokio::test]
async fn test_get_referral_code_success() {
    let app = build_router(ok_service(), allowing_rate_limiter());

    let request = axum::http::Request::builder()
        .uri("/code")
        .method("GET")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let code: ReferralCode = serde_json::from_slice(&body).unwrap();
    assert_eq!(code.0, "test-code");
}

#[tokio::test]
async fn test_get_referral_code_internal_error() {
    let service = MockReferralService {
        result: Err(ReferralError::Internal(anyhow::anyhow!("db error"))),
    };
    let app = build_router(service, allowing_rate_limiter());

    let request = axum::http::Request::builder()
        .uri("/code")
        .method("GET")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn test_get_referral_code_unauthenticated() {
    let state = ReferralRouterState {
        service: Arc::new(ok_service()),
        rate_limiter: allowing_rate_limiter(),
    };
    // No user context extension — should fail auth
    let app: axum::Router = referral_router(state);

    let request = axum::http::Request::builder()
        .uri("/code")
        .method("GET")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_send_invite_succeeds_under_rate_limit() {
    let app = build_router(ok_service(), allowing_rate_limiter());

    let request = axum::http::Request::builder()
        .uri("/send")
        .method("POST")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"recipient": "friend@example.com"}).to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_send_invite_blocked_when_rate_limit_exceeded() {
    let app = build_router(ok_service(), exceeding_rate_limiter());

    let request = axum::http::Request::builder()
        .uri("/send")
        .method("POST")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"recipient": "friend@example.com"}).to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_send_invite_unauthenticated() {
    let state = ReferralRouterState {
        service: Arc::new(ok_service()),
        rate_limiter: allowing_rate_limiter(),
    };
    // No user context extension — should fail auth
    let app: axum::Router = referral_router(state);

    let request = axum::http::Request::builder()
        .uri("/send")
        .method("POST")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"recipient": "friend@example.com"}).to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_get_code_not_affected_by_rate_limit() {
    // GET /code should succeed even when rate limiter would exceed,
    // because rate limiting middleware only applies to /send
    let app = build_router(ok_service(), exceeding_rate_limiter());

    let request = axum::http::Request::builder()
        .uri("/code")
        .method("GET")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
