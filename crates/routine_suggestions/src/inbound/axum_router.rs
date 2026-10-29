//! `/routine-suggestions`: read the signed-in user's suggestions, or start a
//! fresh generation.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};

use crate::domain::model::RoutineSuggestionSet;
use crate::domain::ports::{
    InboxReader, RoutineSuggestionError, RoutineSuggestionRepo, SuggestionGenerator,
};
use crate::domain::service::RoutineSuggestionService;

/// Router state: the service plus the authorization state the extractors
/// authenticate against.
pub struct RoutineSuggestionsRouterState<R, I, G, Auth> {
    /// The suggestion service.
    pub service: Arc<RoutineSuggestionService<R, I, G>>,
    /// The authorization state used by the request extractors.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual impl: the service sits behind `Arc` and need not be `Clone`.
impl<R, I, G, Auth> Clone for RoutineSuggestionsRouterState<R, I, G, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<R, I, G, Auth> FromRef<RoutineSuggestionsRouterState<R, I, G, Auth>>
    for Arc<RoutineSuggestionService<R, I, G>>
{
    fn from_ref(state: &RoutineSuggestionsRouterState<R, I, G, Auth>) -> Self {
        state.service.clone()
    }
}

impl<R, I, G, Auth> FromRef<RoutineSuggestionsRouterState<R, I, G, Auth>>
    for MacroAuthorizationState<Auth>
{
    fn from_ref(state: &RoutineSuggestionsRouterState<R, I, G, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Builds the routine suggestions router.
pub fn routine_suggestions_router<R, I, G, Auth, S>(
    state: RoutineSuggestionsRouterState<R, I, G, Auth>,
) -> Router<S>
where
    R: RoutineSuggestionRepo,
    I: InboxReader,
    G: SuggestionGenerator,
    Auth: MacroAuthorizationService,
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route(
            "/routine-suggestions",
            get(get_suggestions_handler::<R, I, G, Auth>),
        )
        .route(
            "/routine-suggestions/refresh",
            post(refresh_suggestions_handler::<R, I, G, Auth>),
        )
        .with_state(state)
}

fn error_response(error: RoutineSuggestionError) -> Response {
    tracing::error!(error = ?error, "routine suggestions request failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

/// The signed-in user's routine suggestions. Starts generating them when
/// there are none yet or they are a few days old; poll while `status` is
/// `generating`.
#[utoipa::path(
    get,
    path = "/routine-suggestions",
    operation_id = "get_routine_suggestions",
    responses(
        (status = 200, description = "The user's suggestions", body = RoutineSuggestionSet),
        (status = 500, description = "Internal server error"),
    ),
    tag = "routine-suggestions"
)]
pub async fn get_suggestions_handler<R, I, G, Auth>(
    State(service): State<Arc<RoutineSuggestionService<R, I, G>>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response
where
    R: RoutineSuggestionRepo,
    I: InboxReader,
    G: SuggestionGenerator,
    Auth: MacroAuthorizationService,
{
    match service
        .suggestions(&user.authorization.user.macro_user_id)
        .await
    {
        Ok(set) => Json(set).into_response(),
        Err(error) => error_response(error),
    }
}

/// Starts generating fresh suggestions for the signed-in user, unless a
/// generation is already running. Earlier suggestions stay in the answer
/// until the new ones land.
#[utoipa::path(
    post,
    path = "/routine-suggestions/refresh",
    operation_id = "refresh_routine_suggestions",
    responses(
        (status = 200, description = "The user's suggestions, now generating", body = RoutineSuggestionSet),
        (status = 500, description = "Internal server error"),
    ),
    tag = "routine-suggestions"
)]
pub async fn refresh_suggestions_handler<R, I, G, Auth>(
    State(service): State<Arc<RoutineSuggestionService<R, I, G>>>,
    user: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Response
where
    R: RoutineSuggestionRepo,
    I: InboxReader,
    G: SuggestionGenerator,
    Auth: MacroAuthorizationService,
{
    match service
        .refresh(&user.authorization.user.macro_user_id)
        .await
    {
        Ok(set) => Json(set).into_response(),
        Err(error) => error_response(error),
    }
}
