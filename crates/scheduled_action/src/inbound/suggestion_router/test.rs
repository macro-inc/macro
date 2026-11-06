use std::sync::Arc;

use anyhow::{Result, bail};
use axum::Router;
use axum::http::StatusCode;
use macro_authorization::MacroAuthorizationState;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use routine_program::Surface;
use serde_json::{Value, json};

use super::{RoutineSuggestionRouterState, routine_suggestion_router};
use crate::domain::models::ActionPolicyError;
use crate::domain::suggestions::model::{
    GenerationStatus, RoutineSuggestion, RoutineSuggestions, SuggestionPick,
};
use crate::domain::suggestions::ports::RoutineSuggestionApi;
use crate::inbound::axum_router::test::{FakeAuth, request};

const KNOWN: Uuid = Uuid::from_u128(7);

/// One suggestion for anyone signed in; dismisses only `KNOWN`.
struct Suggestions;

fn one(status: GenerationStatus) -> RoutineSuggestions {
    RoutineSuggestions {
        status,
        generated_at: None,
        suggestions: vec![RoutineSuggestion {
            id: KNOWN,
            surface: Surface::Email,
            reason: "You file a lot of mail.".to_owned(),
            keep_probability: 0.8,
            safe_default: true,
            pick: SuggestionPick::Starter {
                key: "inbox".to_owned(),
                knobs: Default::default(),
            },
        }],
    }
}

impl RoutineSuggestionApi for Suggestions {
    async fn suggestions(&self, _: &MacroUserIdStr<'static>) -> Result<RoutineSuggestions> {
        Ok(one(GenerationStatus::Ready))
    }

    async fn refresh(&self, _: &MacroUserIdStr<'static>) -> Result<RoutineSuggestions> {
        Ok(one(GenerationStatus::Generating))
    }

    async fn dismiss(&self, _: &MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        if id != KNOWN {
            bail!(ActionPolicyError::NotFound);
        }
        Ok(())
    }
}

fn router() -> Router {
    routine_suggestion_router(RoutineSuggestionRouterState {
        service: Arc::new(Suggestions),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

#[tokio::test]
async fn serves_suggestions_in_the_wire_shape_clients_read() {
    let app = router();
    let (status, body) = request(
        &app,
        "GET",
        "/scheduled-actions/suggestions",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "status": "ready",
            "generatedAt": null,
            "suggestions": [{
                "id": KNOWN.to_string(),
                "surface": "email",
                "reason": "You file a lot of mail.",
                "keepProbability": 0.8,
                "safeDefault": true,
                "kind": "starter",
                "key": "inbox",
                "knobs": {},
            }],
        })
    );
    let (status, body) = request(
        &app,
        "POST",
        "/scheduled-actions/suggestions/refresh",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["status"], "generating");
}

#[tokio::test]
async fn dismissing_answers_no_content_or_not_found() {
    let app = router();
    let path = |id: Uuid| format!("/scheduled-actions/suggestions/{id}/dismiss");
    assert_eq!(
        request(&app, "POST", &path(KNOWN), "owner", Value::Null)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        request(
            &app,
            "POST",
            &path(Uuid::from_u128(8)),
            "owner",
            Value::Null
        )
        .await
        .0,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        request(
            &app,
            "GET",
            "/scheduled-actions/suggestions",
            "",
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
}
