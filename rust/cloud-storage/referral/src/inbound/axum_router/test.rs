use std::sync::Arc;

use axum::{Extension, http::StatusCode};
use http_body_util::BodyExt;
use model_user::UserContext;
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
        todo!()
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

fn build_router(service: MockReferralService) -> axum::Router {
    let state = ReferralRouterState {
        service: Arc::new(service),
    };
    referral_router(state).layer(Extension(test_user_context()))
}

#[tokio::test]
async fn test_get_referral_code_success() {
    let service = MockReferralService {
        result: Ok(ReferralCode("test-code".to_string())),
    };
    let app = build_router(service);

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
    let app = build_router(service);

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
    let service = MockReferralService {
        result: Ok(ReferralCode("test-code".to_string())),
    };
    let state = ReferralRouterState {
        service: Arc::new(service),
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
