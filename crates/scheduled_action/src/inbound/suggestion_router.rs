use std::sync::Arc;

use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;

use crate::domain::suggestions::model::RoutineSuggestions;
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
            get(list_suggestions::<S, Auth>),
        )
        .route(
            "/scheduled-actions/suggestions/refresh",
            post(refresh_suggestions::<S, Auth>),
        )
        .route(
            "/scheduled-actions/suggestions/{id}/dismiss",
            post(dismiss_suggestion::<S, Auth>),
        )
        .with_state(state)
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/suggestions",
    tag = "scheduled actions",
    operation_id = "list_routine_suggestions",
    responses(
        (status = 200, body = RoutineSuggestions, description = "The routines stored for the caller, best first per surface; reading never generates them (the scheduler does)"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Routine suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
pub async fn list_suggestions<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<RoutineSuggestions>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let suggestions = state
        .service
        .suggestions(&user.authorization.macro_user_id)
        .await?;
    Ok(Json(suggestions))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/suggestions/refresh",
    tag = "scheduled actions",
    operation_id = "refresh_routine_suggestions",
    responses(
        (status = 200, body = RoutineSuggestions, description = "The caller's current suggestions while a new generation runs"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Routine suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
pub async fn refresh_suggestions<S, Auth>(
    State(state): State<RoutineSuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<RoutineSuggestions>, ScheduledActionApiError>
where
    S: RoutineSuggestionApi,
    Auth: MacroAuthorizationService,
{
    let suggestions = state
        .service
        .refresh(&user.authorization.macro_user_id)
        .await?;
    Ok(Json(suggestions))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/suggestions/{id}/dismiss",
    tag = "scheduled actions",
    operation_id = "dismiss_routine_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    responses(
        (status = 204, description = "Not suggested again"),
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
