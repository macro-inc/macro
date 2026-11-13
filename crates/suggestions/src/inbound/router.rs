//! The suggestions routes: the person's feed and what they, or their own agent,
//! do with a suggestion, and the tools generation sessions call from code mode.

use std::sync::Arc;

use axum::extract::rejection::JsonRejection;
use axum::extract::{FromRef, Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use entity_registry::{CreationPrincipalExtractor, NonUserOwners};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
    MacroUserAuthentication, UserOnly,
};
use macro_uuid::Uuid;
use serde::Deserialize;
use utoipa::IntoParams;

use crate::domain::model::{
    Accept, AttachDraft, NewSuggestion, RetireSuggestionRequest, RewriteSuggestion,
    SuggestionCaller, SuggestionError, SuggestionFeed, SuggestionWriteOutcome, SuggestionsReview,
};
use crate::domain::ports::SuggestionApi;

#[cfg(test)]
mod test;

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
            "/suggestions/viewed",
            post(record_suggestions_viewed::<S, Auth>),
        )
        .route(
            "/suggestions/{id}",
            axum::routing::patch(rewrite_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/retire",
            post(retire_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/draft",
            put(attach_suggestion_draft::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/accept",
            post(accept_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/dismiss",
            post(dismiss_suggestion::<S, Auth>),
        )
        .route(
            "/suggestions/{id}/restore",
            post(restore_suggestion::<S, Auth>),
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
            Self::Service(error @ SuggestionError::NotRestorable) => {
                (StatusCode::CONFLICT, error.to_string()).into_response()
            }
            Self::Service(
                error @ (SuggestionError::NotGenerating | SuggestionError::Generating),
            ) => (StatusCode::FORBIDDEN, error.to_string()).into_response(),
            Self::Service(error @ SuggestionError::Changed(_)) => {
                let message = error.to_string();
                let SuggestionError::Changed(suggestion) = error else {
                    unreachable!("matched above")
                };
                (
                    StatusCode::CONFLICT,
                    Json(SuggestionChanged {
                        message,
                        suggestion: *suggestion,
                    }),
                )
                    .into_response()
            }
            Self::Service(SuggestionError::Internal(report)) => {
                tracing::error!(error = ?report, "suggestions call failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

/// The suggestion changed since the caller read it.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct SuggestionChanged {
    /// What happened.
    pub message: String,
    /// The suggestion as it is now, to show before acting on it again.
    pub suggestion: crate::domain::model::Suggestion,
}

/// Acting on a suggestion, as the caller's copy of it shows it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcceptSuggestionRequest {
    /// The suggestion's `updatedAt` as the caller read it. A background suggestion runs
    /// only if it is unchanged since; otherwise the answer is 409.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Who is at the feed. Only the person's own session in the app, with no
/// program's marks (a code-mode invocation, the code-execution header), is
/// the person; any other credential (an agent's, an API token, a program)
/// acts for them. When it can't be told, it is someone acting for them.
fn caller(user: &MacroUserAuthentication, headers: &HeaderMap) -> SuggestionCaller {
    // Validated against its session at the router's boundary.
    let correlation = agent_correlation::context::current();
    if correlation.is_none()
        && user.is_human_session()
        && !headers.contains_key(macro_authorization::CODE_EXECUTION_HEADER)
    {
        SuggestionCaller::User
    } else {
        SuggestionCaller::Agent { correlation }
    }
}

/// The reader's time zone, and how much of the feed to read.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct FeedQuery {
    /// IANA time zone, e.g. `America/New_York`: nightly generations run in
    /// the reader's night.
    #[param(value_type = Option<String>)]
    #[serde(default)]
    pub timezone: Option<chrono_tz::Tz>,
    /// Most open suggestions to return, best first; all when unset. With a
    /// limit the feed leaves out `done`; `counts` always counts every one.
    #[param(value_type = Option<u16>, minimum = 1)]
    #[serde(default)]
    pub limit: Option<std::num::NonZeroU16>,
}

#[utoipa::path(
    get,
    path = "/suggestions",
    tag = "suggestions",
    operation_id = "list_suggestions",
    params(FeedQuery),
    responses(
        (status = 200, body = SuggestionFeed, description = "The caller's open suggestions, best first, and their done ones, latest first: only those they can open every item of"),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not read the feed"),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller's feed, for them or their own agent.
pub async fn list_suggestions<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<SuggestionFeed>, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let caller = caller(&user.authorization, &headers);
    Ok(Json(
        state
            .service
            .feed(
                &user.authorization.macro_user_id,
                caller,
                query.timezone,
                query.limit.map(|limit| usize::from(limit.get())),
            )
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/suggestions/viewed",
    tag = "suggestions",
    operation_id = "record_suggestions_viewed",
    responses(
        (status = 204, description = "Recorded: suggestions proposed until now are no longer new in the feed"),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not record a visit"),
        (status = 404, body = String, description = "Suggestions are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller opened their feed: what it showed as new no longer is. The app
/// sends it once the feed is on screen.
pub async fn record_suggestions_viewed<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let caller = caller(&user.authorization, &headers);
    state
        .service
        .viewed(&user.authorization.macro_user_id, caller)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/suggestions/{id}/accept",
    tag = "suggestions",
    operation_id = "accept_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    request_body = AcceptSuggestionRequest,
    responses(
        (status = 204, description = "Accepted: a background prompt suggestion starts its run when the person accepts it in the app (anyone acting for them only takes it on), any other suggestion is done; accepting a done suggestion again changes nothing"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not accept"),
        (status = 409, body = SuggestionChanged, description = "The suggestion changed since the caller read it: the body has it as it is now"),
        (status = 404, body = String, description = "No open or done suggestion with this id for the caller, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// The caller, or someone acting for them, acts on a suggestion: a background
/// prompt suggestion starts its run when the person accepts it in the app (anyone
/// else only takes it on); any other is done once they act on it (open its
/// item, the composer, the routine), and shows in the feed's `done`.
pub async fn accept_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    body: Result<Json<AcceptSuggestionRequest>, JsonRejection>,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(SuggestionApiError::InvalidRequest)?;
    let caller = caller(&user.authorization, &headers);
    let accept = Accept {
        shown_updated_at: request.updated_at,
        by_person: caller == SuggestionCaller::User,
    };
    state
        .service
        .accept(&user.authorization.macro_user_id, caller, id, accept)
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
        (status = 403, body = String, description = "A generation session may not dismiss"),
        (status = 404, body = String, description = "No open suggestion with this id for the caller, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// The caller, or their own agent, isn't interested in an open suggestion.
pub async fn dismiss_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let caller = caller(&user.authorization, &headers);
    state
        .service
        .dismiss(&user.authorization.macro_user_id, caller, id)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/suggestions/{id}/restore",
    tag = "suggestions",
    operation_id = "restore_suggestion",
    params(("id" = String, Path, description = "ID of the suggestion")),
    responses(
        (status = 204, description = "Open again, as proposed; a run the dismissal stopped stays stopped"),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not restore"),
        (status = 404, body = String, description = "No suggestion with this id for the caller, or suggestions are off"),
        (status = 409, body = String, description = "Not dismissed in the last five minutes, or a routine suggestion"),
        (status = 500, body = String),
    )
)]
/// The caller, or their own agent, takes back dismissing a suggestion, within
/// five minutes of it.
pub async fn restore_suggestion<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, SuggestionApiError>
where
    S: SuggestionApi,
    Auth: MacroAuthorizationService,
{
    let caller = caller(&user.authorization, &headers);
    state
        .service
        .restore(&user.authorization.macro_user_id, caller, id)
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

#[utoipa::path(
    put,
    path = "/suggestions/{id}/draft",
    tag = "suggestions",
    operation_id = "attach_suggestion_draft",
    params(("id" = String, Path, description = "ID of the suggestion")),
    request_body = AttachDraft,
    responses(
        (status = 200, body = SuggestionWriteOutcome, description = "Whether the draft is now the suggestion's, replacing its old one, and what to fix when it isn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only a suggestions generation session may attach a draft"),
        (status = 404, body = String, description = "No such suggestion for the user, or suggestions are off"),
        (status = 500, body = String),
    )
)]
/// Make a reply draft a suggestions generation session wrote the draft of an
/// open reply suggestion. Nothing is sent.
pub async fn attach_suggestion_draft<S, Auth>(
    State(state): State<SuggestionRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<AttachDraft>, JsonRejection>,
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
            .attach_draft(&principal, correlation, id, request)
            .await?,
    ))
}
