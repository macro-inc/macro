use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    Extension,
    extract::ConnectInfo,
    http::{StatusCode, header},
};
use http_body_util::BodyExt;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
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

const TEST_USER_ID: &str = "macro|test@test.com";
const INTERNAL_ACTING_USER_ID: &str = "macro|internal@test.com";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(test_user_context(TEST_USER_ID))
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(claims.user_id.map(|user_id| test_user_context(&user_id)))
    }
}

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

fn test_user_context(user_id: &str) -> UserContext {
    UserContext {
        user_id: user_id.to_string(),
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
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    };
    referral_router(state).layer(Extension(ConnectInfo(SocketAddr::from((
        [127, 0, 0, 1],
        0,
    )))))
}

fn ok_service() -> MockReferralService {
    MockReferralService {
        result: Ok(ReferralCode("test-code".to_string())),
    }
}

fn get_code_request() -> axum::http::Request<axum::body::Body> {
    axum::http::Request::get("/code")
        .header(header::AUTHORIZATION, "Bearer valid")
        .body(axum::body::Body::empty())
        .unwrap()
}

fn send_invite_request() -> axum::http::Request<axum::body::Body> {
    axum::http::Request::post("/send")
        .header(header::AUTHORIZATION, "Bearer valid")
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"recipient": "friend@example.com"}).to_string(),
        ))
        .unwrap()
}

#[tokio::test]
async fn test_get_referral_code_success() {
    let app = build_router(ok_service(), allowing_rate_limiter());

    let response = app.oneshot(get_code_request()).await.unwrap();

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

    let response = app.oneshot(get_code_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn test_get_referral_code_unauthenticated() {
    let app = build_router(ok_service(), allowing_rate_limiter());
    let request = axum::http::Request::get("/code")
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_get_referral_code_accepts_internal_acting_user() {
    let app = build_router(ok_service(), allowing_rate_limiter());
    let request = axum::http::Request::get("/code")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, INTERNAL_ACTING_USER_ID)
        .body(axum::body::Body::empty())
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn test_send_invite_succeeds_under_rate_limit() {
    let app = build_router(ok_service(), allowing_rate_limiter());

    let response = app.oneshot(send_invite_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
}

#[tokio::test]
async fn test_send_invite_blocked_when_rate_limit_exceeded() {
    let app = build_router(ok_service(), exceeding_rate_limiter());

    let response = app.oneshot(send_invite_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn test_send_invite_unauthenticated() {
    let app = build_router(ok_service(), allowing_rate_limiter());
    let request = axum::http::Request::post("/send")
        .header(header::CONTENT_TYPE, "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({"recipient": "friend@example.com"}).to_string(),
        ))
        .unwrap();

    let response = app.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn test_get_code_not_affected_by_rate_limit() {
    let app = build_router(ok_service(), exceeding_rate_limiter());

    let response = app.oneshot(get_code_request()).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}
