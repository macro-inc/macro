//! The suggestions routes: the person's feed and what they do with a suggestion, and
//! the tools generation sessions call from code mode.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRef, Path, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;

use crate::domain::model::{
    NewSuggestion, RetireSuggestionRequest, RewriteSuggestion, SuggestionError, SuggestionFeed,
    SuggestionWriteOutcome, SuggestionsReview,
};
use crate::domain::ports::SuggestionApi;

/// What the suggestions routes share.
pub struct SuggestionRouterState<S, Auth> {
    /// The suggestions service.
    pub service: Arc<S>,
    /// Who is calling.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for SuggestionRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<SuggestionRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &SuggestionRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// A generation session's agent reaches the domain, which accepts only the
/// person's own open suggestions sessions.
impl<S, Auth> FromRef<SuggestionRouterState<S, Auth>> for NonUserOwners {
    fn from_ref(_state: &SuggestionRouterState<S, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

/// The suggestions routes.
pub fn suggestion_router<S, Auth, St>(state: SuggestionRouterState<S, Auth>) -> Router<St>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/suggestions",
            get(list_suggestions::<S, Auth>).post(add_suggestion::<S, Auth>),
        )
        .route("/suggestions/review", get(review_suggestions::<S, Auth>))
        .route(
            "/suggestions/{id}",
            axum::routing::patch(rewrite_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/retire",
            post(retire_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/accept",
            post(accept_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/dismiss",
            post(dismiss_suggestion::<S, Auth>),
        )
        .with_state(state)
}

/// A suggestions call's failure, as an HTTP answer.
pub enum SuggestionApiError {
    /// The body didn't parse.
    InvalidRequest(JsonRejection),
    /// The service refused or failed.
    Service(SuggestionError),
}

impl From<SuggestionError> for SuggestionApiError {
    fn from(error: SuggestionError) -> Self {
        Self::Service(error)
    }
}

impl IntoResponse for SuggestionApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::InvalidRequest(rejection) => {
                // The caller's own input, naming the field it rejected.
                (StatusCode::BAD_REQUEST, rejection.body_text()).into_response()
            }
            Self::Service(error @ SuggestionError::NotFound) => {
                (StatusCode::NOT_FOUND, error.to_string()).into_response()
            }
            Self::Service(error @ SuggestionError::NotGenerating) => {
                (StatusCode::FORBIDDEN, error.to_string()).into_response()
            }
            Self::Service(SuggestionError::Internal(report)) => {
                tracing::error!(error = ?report, "suggestions call failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

#[utoipa::path(
    get,
    path = "/suggestions",
    tag = "suggestions",
    operation_id = "list_suggestions",
    responses(
        (status = 200, body = SuggestionFeed, description = "The caller's open suggestions they can open every item of, best first"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller's feed.
pub async fn list_suggestions<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<SuggestionFeed>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .feed(&user.authorization.macro_user_id)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/suggestions/{id}/accept",
    tag = "suggestions",
    operation_id = "accept_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    responses(
        (status = 204, description = "Accepted: a background prompt suggestion is taken on, any other suggestion is done; accepting a done suggestion again changes nothing"),
        (status = 401, body = String),
        (status = 404, body = String, description = "No open or done suggestion with this id for the caller, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// The caller acts on a suggestion: a background prompt suggestion is taken on; any
/// other is done once they act on it (open its item, the composer, the
/// routine), and shows in the feed's `done`.
pub async fn accept_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .accept(&user.authorization.macro_user_id, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/suggestions/{id}/dismiss",
    tag = "suggestions",
    operation_id = "dismiss_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    responses(
        (status = 204, description = "Dismissed; generation sessions see when"),
        (status = 401, body = String),
        (status = 404, body = String, description = "No open suggestion with this id for the caller, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// The caller isn't interested in an open suggestion.
pub async fn dismiss_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    state
        .service
        .dismiss(&user.authorization.macro_user_id, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    get,
    path = "/suggestions/review",
    tag = "suggestions",
    operation_id = "review_suggestions",
    responses(
        (status = 200, body = SuggestionsReview, description = "Every suggestion of the user's, open first, and how many more this generation may add"),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may review"),
        (status = 404, body = String, description = "Suggestions are off for the user"),
        (status = 500, body = String),
    )
)]
/// What a suggestions generation session reads before managing suggestions.
pub async fn review_suggestions<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
) -> Result<Json<SuggestionsReview>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    // The code-mode invocation the credential names, already validated
    // against its session at the router's boundary.
    let correlation = agent_correlation::context::current();
    Ok(Json(state.service.review(&principal, correlation).await?))
}

#[utoipa::path(
    post,
    path = "/suggestions",
    tag = "suggestions",
    operation_id = "add_suggestion",
    request_body = NewSuggestion,
    responses(
        (status = 200, body = SuggestionWriteOutcome, description = "Whether the suggestion was added or updated, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may suggest"),
        (status = 404, body = String, description = "Suggestions are off for the user"),
        (status = 500, body = String),
    )
)]
/// Add a suggestion from a suggestions generation session, or a new version of the
/// one with its dedup key.
pub async fn add_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<NewSuggestion>, JsonRejection>,
) -> Result<Json<SuggestionWriteOutcome>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(SuggestionApiError::InvalidRequest)?;
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .suggest(&principal, correlation, request)
            .await?,
    ))
}

#[utoipa::path(
    patch,
    path = "/suggestions/{id}",
    tag = "suggestions",
    operation_id = "rewrite_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    request_body = RewriteSuggestion,
    responses(
        (status = 200, body = SuggestionWriteOutcome, description = "Whether the suggestion was rewritten, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may rewrite"),
        (status = 404, body = String, description = "No such suggestion for the user, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// Change an open suggestion from a suggestions generation session.
pub async fn rewrite_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<RewriteSuggestion>, JsonRejection>,
) -> Result<Json<SuggestionWriteOutcome>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(SuggestionApiError::InvalidRequest)?;
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .rewrite(&principal, correlation, id, request)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/suggestions/{id}/retire",
    tag = "suggestions",
    operation_id = "retire_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    request_body = RetireSuggestionRequest,
    responses(
        (status = 200, body = SuggestionWriteOutcome, description = "Whether the suggestion was retired, and why not when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may retire"),
        (status = 404, body = String, description = "No such suggestion for the user, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// Retire an open suggestion from a suggestions generation session.
pub async fn retire_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<RetireSuggestionRequest>, JsonRejection>,
) -> Result<Json<SuggestionWriteOutcome>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(SuggestionApiError::InvalidRequest)?;
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .retire(&principal, correlation, id, request)
            .await?,
    ))
}
