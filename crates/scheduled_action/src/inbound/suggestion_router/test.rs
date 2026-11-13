use std::sync::Arc;

use anyhow::{Result, bail};
use axum::Router;
use axum::http::StatusCode;
use macro_authorization::MacroAuthorizationState;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::CreationPrincipal;
use routine_program::Surface;
use serde_json::{Value, json};

use super::{RoutineSuggestionRouterState, routine_suggestion_router};
use crate::domain::models::ActionPolicyError;
use crate::domain::suggestions::model::{
    GenerationStatus, RetireSuggestion, RoutineSuggestion, RoutineSuggestions, SuggestOutcome,
    SuggestRequest, SuggestedPick, SuggestionFrom, SuggestionReview,
};
use crate::domain::suggestions::ports::RoutineSuggestionApi;
use crate::inbound::axum_router::test::{FakeAuth, request};

const KNOWN: Uuid = Uuid::from_u128(7);

/// One suggestion for anyone signed in; dismisses only `KNOWN`; no
/// request is a suggestion session's.
struct Suggestions;

fn one(status: GenerationStatus) -> RoutineSuggestions {
    RoutineSuggestions {
        status,
        suggestions: vec![RoutineSuggestion {
            id: KNOWN,
            from: SuggestionFrom::ForYou,
            surfaces: vec![Surface::Email, Surface::Tasks],
            reason: Some("You file a lot of mail.".to_owned()),
            keep_probability: Some(0.75),
            on_by_default: true,
            pick: SuggestedPick::Catalog {
                key: "inbox".to_owned(),
                knobs: Default::default(),
            },
        }],
    }
}

impl RoutineSuggestionApi for Suggestions {
    async fn suggestions(
        &self,
        _: &MacroUserIdStr<'static>,
        surface: Option<Surface>,
    ) -> Result<RoutineSuggestions> {
        assert_eq!(surface, Some(Surface::Email));
        Ok(one(GenerationStatus::Ready))
    }

    async fn brief(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Surface],
        _: suggestions::domain::model::GenerationTrigger,
        _: chrono_tz::Tz,
    ) -> Result<String> {
        unreachable!("routes never brief")
    }

    async fn texts(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &[Uuid],
        _: chrono_tz::Tz,
    ) -> Result<Vec<(Uuid, suggestions::domain::model::RoutineText)>> {
        unreachable!("routes never word cards")
    }

    async fn kept(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> Result<u32> {
        unreachable!("routes never count")
    }

    async fn record(
        &self,
        _: &MacroUserIdStr<'static>,
        _: crate::domain::suggestions::model::RoutineGenerationReport,
    ) {
        unreachable!("routes never log generations")
    }

    async fn review(
        &self,
        _: &CreationPrincipal,
        correlation: Option<Uuid>,
    ) -> Result<SuggestionReview> {
        assert_eq!(correlation, None);
        bail!(ActionPolicyError::NotSuggesting)
    }

    async fn retire(
        &self,
        _: &CreationPrincipal,
        correlation: Option<Uuid>,
        _: Uuid,
        _: RetireSuggestion,
    ) -> Result<SuggestOutcome> {
        assert_eq!(correlation, None);
        bail!(ActionPolicyError::NotSuggesting)
    }

    async fn dismiss(&self, _: &MacroUserIdStr<'static>, id: Uuid) -> Result<()> {
        if id != KNOWN {
            bail!(ActionPolicyError::NotFound);
        }
        Ok(())
    }

    async fn suggest(
        &self,
        _: &CreationPrincipal,
        correlation: Option<Uuid>,
        _: SuggestRequest,
    ) -> Result<SuggestOutcome> {
        assert_eq!(correlation, None);
        bail!(ActionPolicyError::NotSuggesting)
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
        "/scheduled-actions/suggestions?surface=email",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        body,
        json!({
            "status": "ready",
            "suggestions": [{
                "id": KNOWN.to_string(),
                "from": "for_you",
                "surfaces": ["email", "tasks"],
                "reason": "You file a lot of mail.",
                "keepProbability": 0.75,
                "onByDefault": true,
                "kind": "catalog",
                "key": "inbox",
                "knobs": {},
            }],
        })
    );
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
}

#[tokio::test]
async fn suggesting_outside_a_suggestion_session_is_forbidden() {
    let (status, _) = request(
        &router(),
        "POST",
        "/scheduled-actions/suggestions",
        "owner",
        json!({
            "kind": "catalog",
            "key": "inbox",
            "reason": "fits",
            "surfaces": ["email"],
            "keepProbability": 0.5,
        }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn reviewing_and_retiring_outside_a_routines_session_is_forbidden() {
    let app = router();
    let (status, _) = request(
        &app,
        "GET",
        "/scheduled-actions/suggestions/review",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = request(
        &app,
        "POST",
        &format!("/scheduled-actions/suggestions/{KNOWN}/retire"),
        "owner",
        json!({ "reason": "No longer fits" }),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
}
