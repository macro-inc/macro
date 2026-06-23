//! Integration tests for the ai projections axum router.

use std::sync::Arc;

use axum::{Extension, http::StatusCode};
use http_body_util::BodyExt;
use macro_user_id::user_id::MacroUserIdStr;
use model_user::UserContext;
use tower::ServiceExt;

use super::{AiProjectionRouterState, ai_projections_router};
use crate::domain::{
    ai_projection_service::AiProjectionService,
    model::{
        AiProjectionError, ProjectionStatus, UpsertProjectionError, UpsertProjectionParams,
        UserAiProjection,
    },
};

#[derive(Clone)]
struct MockService {
    has_permission: bool,
}

impl AiProjectionService for MockService {
    async fn upsert_projection(
        &self,
        user_id: &MacroUserIdStr<'_>,
        params: UpsertProjectionParams,
    ) -> Result<UserAiProjection, UpsertProjectionError> {
        Ok(UserAiProjection {
            ai_projection_id: params.id,
            target_id: user_id.as_ref().to_string(),
            prompt_hash: "hash".to_string(),
            status: ProjectionStatus::Cold,
            result: None,
            error: None,
            generated_at: None,
            stale_at: None,
        })
    }

    async fn has_professional_features(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<bool, AiProjectionError> {
        Ok(self.has_permission)
    }

    async fn materialize(
        &self,
        _message: models_ai_projection::AiProjectionQueueMessage,
    ) -> Result<(), AiProjectionError> {
        Ok(())
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

fn build_router(has_permission: bool) -> axum::Router {
    let state = AiProjectionRouterState {
        service: Arc::new(MockService { has_permission }),
    };
    ai_projections_router(state).layer(Extension(test_user_context()))
}

fn post_request() -> axum::http::Request<axum::body::Body> {
    axum::http::Request::builder()
        .uri("/ai-projections")
        .method("POST")
        .header("content-type", "application/json")
        .body(axum::body::Body::from(
            serde_json::json!({
                "id": "inbox/important",
                "prompt": "What is important?",
                "target_type": "user",
                "refresh_cadence": "high",
                "expiry": "day"
            })
            .to_string(),
        ))
        .unwrap()
}

#[tokio::test]
async fn upsert_projection_returns_cold_state_for_professional_user() {
    let app = build_router(true);

    let response = app.oneshot(post_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let body = response.into_body().collect().await.unwrap().to_bytes();
    let json: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(json["id"], "inbox/important");
    assert_eq!(json["status"], "cold");
    assert!(json["data"].is_null());
}

#[tokio::test]
async fn upsert_projection_is_forbidden_without_professional_features() {
    let app = build_router(false);

    let response = app.oneshot(post_request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
}
