//! The ideas routes: the person's feed and what they, or their own agent,
//! do with an idea, and the tools generation sessions call from code mode.

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
    Accept, AttachDraft, IdeaCaller, IdeaError, IdeaReview, IdeaWriteOutcome, Ideas, RetireIdea,
    RewriteIdea, SuggestIdea,
};
use crate::domain::ports::IdeaApi;

#[cfg(test)]
mod test;

/// What the ideas routes share.
pub struct IdeaRouterState<S, Auth> {
    /// The ideas service.
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
/// person's own open ideas sessions.
impl<S, Auth> FromRef<IdeaRouterState<S, Auth>> for NonUserOwners {
    fn from_ref(_state: &IdeaRouterState<S, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

/// The ideas routes.
pub fn idea_router<S, Auth, St>(state: IdeaRouterState<S, Auth>) -> Router<St>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/ideas",
            get(list_ideas::<S, Auth>).post(suggest_idea::<S, Auth>),
        )
        .route("/ideas/review", get(review_ideas::<S, Auth>))
        .route("/ideas/{id}", axum::routing::patch(rewrite_idea::<S, Auth>))
        .route("/ideas/{id}/retire", post(retire_idea::<S, Auth>))
        .route("/ideas/{id}/draft", put(attach_idea_draft::<S, Auth>))
        .route("/ideas/{id}/accept", post(accept_idea::<S, Auth>))
        .route("/ideas/{id}/dismiss", post(dismiss_idea::<S, Auth>))
        .with_state(state)
}

/// An ideas call's failure, as an HTTP answer.
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
            Self::Service(error @ (IdeaError::NotGenerating | IdeaError::Generating)) => {
                (StatusCode::FORBIDDEN, error.to_string()).into_response()
            }
            Self::Service(error @ IdeaError::Changed) => {
                (StatusCode::CONFLICT, error.to_string()).into_response()
            }
            Self::Service(IdeaError::Internal(report)) => {
                tracing::error!(error = ?report, "ideas call failed");
                (StatusCode::INTERNAL_SERVER_ERROR, "internal error").into_response()
            }
        }
    }
}

/// Acting on an idea, as the caller's copy of it shows it.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AcceptIdeaRequest {
    /// The idea's `updatedAt` as the caller read it. A background idea runs
    /// only if it is unchanged since; otherwise the answer is 409.
    pub updated_at: chrono::DateTime<chrono::Utc>,
}

/// Who is at the feed. Only the person's own session in the app, with no
/// program's marks (a code-mode invocation, the code-execution header), is
/// the person; any other credential (an agent's, an API token, a program)
/// acts for them. When it can't be told, it is someone acting for them.
fn caller(user: &MacroUserAuthentication, headers: &HeaderMap) -> IdeaCaller {
    // Validated against its session at the router's boundary.
    let correlation = agent_correlation::context::current();
    if correlation.is_none()
        && user.is_human_session()
        && !headers.contains_key(macro_authorization::CODE_EXECUTION_HEADER)
    {
        IdeaCaller::User
    } else {
        IdeaCaller::Agent { correlation }
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
        (status = 200, body = Ideas, description = "The caller's open ideas they can open every item of, best first"),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not read the feed"),
        (status = 404, body = String, description = "Ideas are off for the caller"),
        (status = 500, body = String),
    )
)]
/// The caller's feed, for them or their own agent.
pub async fn list_ideas<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Query(query): Query<FeedQuery>,
) -> Result<Json<Ideas>, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    let caller = caller(&user.authorization, &headers);
    Ok(Json(
        state
            .service
            .feed(&user.authorization.macro_user_id, caller, query.timezone)
            .await?,
    ))
}

#[utoipa::path(
    post,
    path = "/ideas/{id}/accept",
    tag = "ideas",
    operation_id = "accept_idea",
    params(("id" = String, Path, description = "ID of the idea")),
    request_body = AcceptIdeaRequest,
    responses(
        (status = 204, description = "Accepted: a background prompt idea starts its run when the person accepts it in the app (anyone acting for them only takes it on), any other idea is done; accepting a done idea again changes nothing"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not accept"),
        (status = 409, body = String, description = "The idea changed since the caller read it: read it again"),
        (status = 404, body = String, description = "No open or done idea with this id for the caller, or ideas are off"),
        (status = 500, body = String),
    )
)]
/// The caller, or someone acting for them, acts on an idea: a background
/// prompt idea starts its run when the person accepts it in the app (anyone
/// else only takes it on); any other is done once they act on it (open its
/// item, the composer, the routine), and shows in the feed's `done`.
pub async fn accept_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
    body: Result<Json<AcceptIdeaRequest>, JsonRejection>,
) -> Result<StatusCode, IdeaApiError>
where
    S: IdeaApi,
    Auth: MacroAuthorizationService,
{
    let Json(request) = body.map_err(IdeaApiError::InvalidRequest)?;
    let caller = caller(&user.authorization, &headers);
    let accept = Accept {
        shown_updated_at: request.updated_at,
        by_person: caller == IdeaCaller::User,
    };
    state
        .service
        .accept(&user.authorization.macro_user_id, caller, id, accept)
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(
    post,
    path = "/ideas/{id}/dismiss",
    tag = "ideas",
    operation_id = "dismiss_idea",
    params(("id" = String, Path, description = "ID of the idea")),
    responses(
        (status = 204, description = "Dismissed; generation sessions see when"),
        (status = 401, body = String),
        (status = 403, body = String, description = "A generation session may not dismiss"),
        (status = 404, body = String, description = "No open idea with this id for the caller, or ideas are off"),
        (status = 500, body = String),
    )
)]
/// The caller, or their own agent, isn't interested in an open idea.
pub async fn dismiss_idea<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    user: MacroAuthorizationExtractor<Auth, UserOnly>,
    headers: HeaderMap,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, IdeaApiError>
where
    S: IdeaApi,
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
    get,
    path = "/ideas/review",
    tag = "ideas",
    operation_id = "review_ideas",
    responses(
        (status = 200, body = IdeaReview, description = "Every idea of the user's, open first, and how many more this generation may add"),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only an ideas generation session may review"),
        (status = 404, body = String, description = "Ideas are off for the user"),
        (status = 500, body = String),
    )
)]
/// What an ideas generation session reads before managing ideas.
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
    path = "/ideas",
    tag = "ideas",
    operation_id = "suggest_idea",
    request_body = SuggestIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the idea was added or updated, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only an ideas generation session may suggest"),
        (status = 404, body = String, description = "Ideas are off for the user"),
        (status = 500, body = String),
    )
)]
/// Add an idea from an ideas generation session, or a new version of the
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
    path = "/ideas/{id}",
    tag = "ideas",
    operation_id = "rewrite_idea",
    params(("id" = String, Path, description = "ID of the idea")),
    request_body = RewriteIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the idea was rewritten, and what to fix when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only an ideas generation session may rewrite"),
        (status = 404, body = String, description = "No such idea for the user, or ideas are off"),
        (status = 500, body = String),
    )
)]
/// Change an open idea from an ideas generation session.
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
    path = "/ideas/{id}/retire",
    tag = "ideas",
    operation_id = "retire_idea",
    params(("id" = String, Path, description = "ID of the idea")),
    request_body = RetireIdea,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the idea was retired, and why not when it wasn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only an ideas generation session may retire"),
        (status = 404, body = String, description = "No such idea for the user, or ideas are off"),
        (status = 500, body = String),
    )
)]
/// Retire an open idea from an ideas generation session.
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

#[utoipa::path(
    put,
    path = "/ideas/{id}/draft",
    tag = "ideas",
    operation_id = "attach_idea_draft",
    params(("id" = String, Path, description = "ID of the idea")),
    request_body = AttachDraft,
    responses(
        (status = 200, body = IdeaWriteOutcome, description = "Whether the draft is now the idea's, replacing its old one, and what to fix when it isn't"),
        (status = 400, body = String),
        (status = 401, body = String),
        (status = 403, body = String, description = "Only an ideas generation session may attach a draft"),
        (status = 404, body = String, description = "No such idea for the user, or ideas are off"),
        (status = 500, body = String),
    )
)]
/// Make a reply draft an ideas generation session wrote the draft of an
/// open reply idea. Nothing is sent.
pub async fn attach_idea_draft<S, Auth>(
    State(state): State<IdeaRouterState<S, Auth>>,
    CreationPrincipalExtractor { principal, .. }: CreationPrincipalExtractor<Auth>,
    Path(id): Path<Uuid>,
    body: Result<Json<AttachDraft>, JsonRejection>,
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
            .attach_draft(&principal, correlation, id, request)
            .await?,
    ))
}
