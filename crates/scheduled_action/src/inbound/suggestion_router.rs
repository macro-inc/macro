use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use routine_program::Surface;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::domain::suggestions::model::{
    RetireSuggestion, RoutineSuggestions, SuggestOutcome, SuggestRequest, SuggestionReview,
};
use crate::domain::suggestions::ports::RoutineSuggestionApi;
use crate::inbound::axum_router::ScheduledActionApiError;

#[cfg(test)]
mod test;

pub struct RoutineSuggestionRouterState<S, Auth> {
    pub service: Arc<S>,
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for RoutineSuggestionRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<RoutineSuggestionRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &RoutineSuggestionRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The session's agent reaches the domain, which accepts only the person's
/// own suggestion sessions.
impl<S, Auth> FromRef<RoutineSuggestionRouterState<S, Auth>> for NonUserOwners {
    fn from_ref(_state: &RoutineSuggestionRouterState<S, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

pub fn routine_suggestion_router<S, Auth, St>(
    state: RoutineSuggestionRouterState<S, Auth>,
) -> Router<St>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/suggestions",
            get(list_suggestions::<S, Auth>).post(suggest_routine::<S, Auth>),
        )
        .route(
            "/scheduled-actions/suggestions/review",
            get(review_suggestions::<S, Auth>),
        )
        .route(
            "/scheduled-actions/suggestions/{id}/retire",
            post(retire_suggestion::<S, Auth>),
        )
        .route(
            "/scheduled-actions/suggestions/{id}/dismiss",
            post(dismiss_suggestion::<S, Auth>),
        )
        .with_state(state)
}

/// Which surface's suggestions to read.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct SuggestionsQuery {
    /// Only this surface's; every surface's when absent.
    #[serde(default)]
    pub surface: Option<Surface>,
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/suggestions",
    tag = "scheduled actions",
    operation_id = "list_routine_suggestions",
    params(SuggestionsQuery),
    responses(
        (status = 200, body = RoutineSuggestions, description = "Per surface, the routines AI suggested for the caller, then Macro's templates; reading never generates"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Routine suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
pub async fn list_suggestions<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<SuggestionsQuery>,
) -> Result<Json<RoutineSuggestions>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let suggestions = state
        .service
        .suggestions(&user.authorization.macro_user_id, query.surface)
        .await?;
    Ok(Json(suggestions))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/suggestions/{id}/dismiss",
    tag = "scheduled actions",
    operation_id = "dismiss_routine_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion, AI's or a template's")),
    responses(
        (status = 204, description = "Never suggested again, on any surface"),
        (status = 401, body = String),
        (status = 404, body = String, description = "No such suggestion for the caller, or suggestions are off"),
        (status = 500, body = String),
    )
)]
pub async fn dismiss_suggestion<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .dismiss(&user.authorization.macro_user_id, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/suggestions",
    tag = "scheduled actions",
    operation_id = "suggest_routine",
    request_body = SuggestRequest,
    responses(
        (status = 200, body = SuggestOutcome, description = "Whether the suggestion was kept, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a routine suggestion session may suggest"),
        (status = 500, body = String),
    )
)]
/// Hand back one routine suggestion from a routine suggestion session, the
/// way a draft's session checks its routine: a catalog routine with knob
/// values, or a drafted routine, checked as saving checks it.
pub async fn suggest_routine<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<SuggestRequest>, JsonRejection>,
) -> Result<Json<SuggestOutcome>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    // The code-mode invocation the credential names, already validated
    // against its session at the router's boundary.
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .suggest(&principal, correlation, request)
            .await?,
    ))
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/suggestions/review",
    tag = "scheduled actions",
    operation_id = "review_routine_suggestions",
    responses(
        (status = 200, body = SuggestionReview, description = "Every suggestion AI made for the user, open or not"),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a routines generation session may review"),
        (status = 404, body = String, description = "Routine suggestions are off for the user"),
        (status = 500, body = String),
    )
)]
/// What a routines generation session reads before managing suggestions.
pub async fn review_suggestions<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
) -> Result<Json<SuggestionReview>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let correlation = agent_correlation::context::current();
    Ok(Json(state.service.review(&principal, correlation).await?))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/suggestions/{id}/retire",
    tag = "scheduled actions",
    operation_id = "retire_routine_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    request_body = RetireSuggestion,
    responses(
        (status = 200, body = SuggestOutcome, description = "Whether the suggestion was retired, and why not when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a routines generation session may retire"),
        (status = 500, body = String),
    )
)]
/// Retire an open suggestion that no longer fits, from a routines
/// generation session.
pub async fn retire_suggestion<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<RetireSuggestion>, JsonRejection>,
) -> Result<Json<SuggestOutcome>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(ScheduledActionApiError::InvalidRequest)?;
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .retire(&principal, correlation, id, request)
            .await?,
    ))
}
