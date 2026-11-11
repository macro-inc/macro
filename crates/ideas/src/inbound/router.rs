//! The ideas routes: the person's feed and what they do with an idea, and
//! the tools generation sessions call from code mode.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_uuid::Uuid;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::domain::model::{
    IdeaError, IdeaReview, IdeaWriteOutcome, Ideas, RetireIdea, RewriteIdea, SuggestIdea,
};
use crate::domain::ports::IdeaApi;

/// What the suggestions routes share.
pub struct IdeaRouterState<S, Auth> {
    /// The suggestions service.
    pub service: Arc<S>,
    /// Who is calling.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for IdeaRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S, Auth> FromRef<IdeaRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &IdeaRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// A generation session's agent reaches the domain, which accepts only the
/// person's own open suggestions sessions.
impl<S, Auth> FromRef<IdeaRouterState<S, Auth>> for NonUserOwners {
    fn from_ref(_state: &IdeaRouterState<S, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

/// The suggestions routes.
pub fn idea_router<S, Auth, St>(state: IdeaRouterState<S, Auth>) -> Router<St>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/suggestions",
            get(list_ideas::<S, Auth>).post(suggest_idea::<S, Auth>),
        )
        .route("/suggestions/review", get(review_ideas::<S, Auth>))
        .route(
            "/suggestions/{id}",
            axum::routing::patch(rewrite_idea::<S, Auth>),
        )
        .route("/suggestions/{id}/retire", post(retire_idea::<S, Auth>))
        .route("/suggestions/{id}/accept", post(accept_idea::<S, Auth>))
        .route("/suggestions/{id}/dismiss", post(dismiss_idea::<S, Auth>))
        .with_state(state)
}

/// A suggestions call's failure, as an HTTP answer.
pub enum IdeaApiError {
    /// The body didn't parse.
    InvalidRequest(JsonRejection),
    /// The service refused or failed.
    Service(IdeaError),
}

impl From<IdeaError> for IdeaApiError {
    fn from(error: IdeaError) -> Self {
        Self::Service(error)
    }
}

impl IntoResponse for IdeaApiError {
    fn into_response(self) -> axum::response::Response {
        match self {
            Self::InvalidRequest(rejection) => {
                // The caller's own input, naming the field it rejected.
                (StatusCode::BAD_REQUEST, rejection.body_text()).into_response()
            }
            Self::Service(error @ IdeaError::NotFound) => {
                (StatusCode::NOT_FOUND, error.to_string()).into_response()
            }
            Self::Service(error @ IdeaError::NotGenerating) => {
                (StatusCode::FORBIDDEN, error.to_string()).into_response()
            }
            Self::Service(IdeaError::Internal(report)) => {
                tracing::error!(error = ?report, "suggestions call failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

/// The reader's time zone.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FeedQuery {
    /// IANA time zone, e.g. `America/New_York`: nightly generations run in
    /// the reader's night.
    #[param(value_type = Option<String>)]
    #[serde(default)]
    pub timezone: Option<chrono_tz::Tz>,
}

#[utoipa::path(
    get,
    path = "/ideas",
    tag = "ideas",
    operation_id = "list_ideas",
    params(FeedQuery),
    responses(
        (status = 200, body = Ideas, description = "The caller's open suggestions they can open every item of, best first"),
        (status = 401, body = String),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller's feed.
pub async fn list_ideas<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<Ideas>, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    Ok(Json(
        state
            .service
            .feed(&user.authorization.macro_user_id, query.timezone)
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
pub async fn accept_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, IdeaApiError>
where
    S: IdeaApi,
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
pub async fn dismiss_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, IdeaApiError>
where
    S: IdeaApi,
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
        (status = 200, body = IdeaReview, description = "Every suggestion of the user's, open first, and how many more this generation may add"),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may review"),
        (status = 404, body = String, description = "Suggestions are off for the user"),
        (status = 500, body = String),
    )
)]
/// What a suggestions generation session reads before managing suggestions.
pub async fn review_ideas<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
) -> Result<Json<IdeaReview>, IdeaApiError>
where
    S: IdeaApi,
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
    request_body = SuggestIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the suggestion was added or updated, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may suggest"),
        (status = 404, body = String, description = "Suggestions are off for the user"),
        (status = 500, body = String),
    )
)]
/// Add a suggestion from a suggestions generation session, or a new version of the
/// one with its dedup key.
pub async fn suggest_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    body: Result<Json<SuggestIdea>, JsonRejection>,
) -> Result<Json<IdeaWriteOutcome>, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(IdeaApiError::InvalidRequest)?;
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
    request_body = RewriteIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the suggestion was rewritten, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may rewrite"),
        (status = 404, body = String, description = "No such suggestion for the user, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// Change an open suggestion from a suggestions generation session.
pub async fn rewrite_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<RewriteIdea>, JsonRejection>,
) -> Result<Json<IdeaWriteOutcome>, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(IdeaApiError::InvalidRequest)?;
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
    request_body = RetireIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the suggestion was retired, and why not when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may retire"),
        (status = 404, body = String, description = "No such suggestion for the user, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// Retire an open suggestion from a suggestions generation session.
pub async fn retire_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<RetireIdea>, JsonRejection>,
) -> Result<Json<IdeaWriteOutcome>, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(IdeaApiError::InvalidRequest)?;
    let correlation = agent_correlation::context::current();
    Ok(Json(
        state
            .service
            .retire(&principal, correlation, id, request)
            .await?,
    ))
}
