//! HTTP: the internal create/delete API and public smart HTTP.

pub mod credential;

use std::str::FromStr;
use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, Path, Query, State},
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{any, delete, get, post},
};
use futures::TryStreamExt;
use macro_authorization::{
    InternalOnly, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;

use crate::api::{
    CreateRepoRequest, CreatedRepoResponse, EnsureRepoRequest, SetVoiceRequest, VoiceQuery,
};
use crate::domain::models::{AgentGitError, GitEndpoint, GitRequest, GitService};
use crate::domain::ports::AgentGitService;
use crate::domain::voice::VoiceConfig;
use credential::{BASIC_CHALLENGE, GitCredentialExtractor};

/// Suffix of every repo path segment.
const REPO_SUFFIX: &str = ".git";
/// `Git-Protocol` request header (protocol v2).
const GIT_PROTOCOL_HEADER: &str = "git-protocol";
/// Media type git-lfs reads error messages from.
const LFS_MEDIA_TYPE: &str = "application/vnd.git-lfs+json";

/// Router state.
pub struct AgentGitRouterState<Service, Auth> {
    service: Arc<Service>,
    authorization_state: MacroAuthorizationState<Auth>,
    public_base_url: String,
}

impl<Service, Auth> Clone for AgentGitRouterState<Service, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
            public_base_url: self.public_base_url.clone(),
        }
    }
}

impl<Service, Auth> AgentGitRouterState<Service, Auth> {
    /// `public_base_url` is where clients reach this router (clone URLs are
    /// built from it), without a trailing slash.
    pub fn new(
        service: Arc<Service>,
        authorization_state: MacroAuthorizationState<Auth>,
        public_base_url: String,
    ) -> Self {
        Self {
            service,
            authorization_state,
            public_base_url,
        }
    }
}

impl<Service, Auth> FromRef<AgentGitRouterState<Service, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &AgentGitRouterState<Service, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The internal API and smart HTTP.
///
/// - `POST /internal/repos`: create or re-key a repo (internal key).
/// - `DELETE /internal/repos/{agent_user_id}`: delete it (internal key).
/// - `GET`/`PUT /internal/repos/{agent_user_id}/voice`: read or commit
///   `config/voice.json` for an already authorized team (internal key).
/// - `GET /{agent_user_id}.git/info/refs?service=…`
/// - `POST /{agent_user_id}.git/git-upload-pack`
/// - `POST /{agent_user_id}.git/git-receive-pack`
/// - `/{agent_user_id}.git/info/lfs/…`: rejected, LFS is not supported.
pub fn agent_git_router<Service, Auth, Outer>(
    state: AgentGitRouterState<Service, Auth>,
) -> Router<Outer>
where
    Service: AgentGitService,
    Auth: MacroAuthorizationService,
    Outer: Send + Sync + 'static,
{
    Router::new()
        .route("/internal/repos", post(create_repo::<Service, Auth>))
        .route("/internal/repos/ensure", post(ensure_repo::<Service, Auth>))
        .route(
            "/internal/repos/{agent_user_id}",
            delete(delete_repo::<Service, Auth>),
        )
        .route(
            "/internal/repos/{agent_user_id}/voice",
            get(read_voice::<Service, Auth>).put(set_voice::<Service, Auth>),
        )
        .route("/{repository}/info/refs", get(info_refs::<Service, Auth>))
        .route(
            "/{repository}/git-upload-pack",
            post(upload_pack::<Service, Auth>),
        )
        .route(
            "/{repository}/git-receive-pack",
            post(receive_pack::<Service, Auth>),
        )
        .route("/{repository}/info/lfs/{*rest}", any(lfs_unsupported))
        .with_state(state)
}

fn text(status: StatusCode, message: String) -> Response {
    (
        status,
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("{message}\n"),
    )
        .into_response()
}

/// Error responses. Plain text, which git prints to the user as `remote: …`.
pub struct AgentGitHttpError(AgentGitError);

impl From<AgentGitError> for AgentGitHttpError {
    fn from(error: AgentGitError) -> Self {
        Self(error)
    }
}

impl IntoResponse for AgentGitHttpError {
    fn into_response(self) -> Response {
        let message = self.0.to_string();

        match self.0 {
            AgentGitError::InvalidToken => (
                StatusCode::UNAUTHORIZED,
                [(header::WWW_AUTHENTICATE, BASIC_CHALLENGE)],
                format!("{message}\n"),
            )
                .into_response(),
            AgentGitError::NotFound | AgentGitError::NoVoice => {
                text(StatusCode::NOT_FOUND, message)
            }
            AgentGitError::EncodedPush => text(StatusCode::UNSUPPORTED_MEDIA_TYPE, message),
            AgentGitError::Forbidden(_) => text(StatusCode::FORBIDDEN, message),
            AgentGitError::TeamMismatch => text(StatusCode::CONFLICT, message),
            AgentGitError::RepoTooLarge { .. } => text(StatusCode::PAYLOAD_TOO_LARGE, message),
            AgentGitError::PushRateLimited => text(StatusCode::TOO_MANY_REQUESTS, message),
            AgentGitError::RepoBusy => text(StatusCode::CONFLICT, message),
            AgentGitError::Internal(report) => {
                tracing::error!(error = ?report, "agent git request failed");
                text(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal error".to_owned(),
                )
            }
        }
    }
}

fn bad_request(message: &str) -> Response {
    text(StatusCode::BAD_REQUEST, message.to_owned())
}

/// `<agent_user_id>.git` → the agent's user id.
fn parse_repository(repository: &str) -> Result<MacroUserIdStr<'static>, AgentGitError> {
    let agent_user_id = repository
        .strip_suffix(REPO_SUFFIX)
        .ok_or(AgentGitError::NotFound)?;

    MacroUserIdStr::try_from(agent_user_id.to_owned()).map_err(|_| AgentGitError::NotFound)
}

fn header_string(
    headers: &HeaderMap,
    name: impl axum::http::header::AsHeaderName,
) -> Option<String> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned)
}

async fn serve<Service: AgentGitService>(
    service: &Service,
    credential: crate::domain::models::GitCredential,
    repository: &str,
    endpoint: GitEndpoint,
    headers: &HeaderMap,
    body: Body,
) -> Response {
    let agent_user_id = match parse_repository(repository) {
        Ok(agent_user_id) => agent_user_id,
        Err(error) => {
            tracing::Span::current().record("otel.status_code", "ERROR");
            let reason = match &error {
                AgentGitError::NotFound => "not_found",
                AgentGitError::InvalidToken => "invalid_token",
                AgentGitError::Forbidden(_) => "forbidden",
                AgentGitError::RepoTooLarge { .. } => "repo_too_large",
                AgentGitError::PushRateLimited => "rate_limited",
                AgentGitError::RepoBusy => "busy",
                _ => "internal",
            };
            tracing::Span::current().record("git.rejected_reason", reason);
            return AgentGitHttpError(error).into_response();
        }
    };

    let request = GitRequest {
        endpoint,
        content_type: header_string(headers, header::CONTENT_TYPE),
        content_encoding: headers
            .get(header::CONTENT_ENCODING)
            .map(|value| value.to_str().unwrap_or("invalid").to_owned()),
        git_protocol: header_string(headers, GIT_PROTOCOL_HEADER),
        body: Box::pin(body.into_data_stream().map_err(std::io::Error::other)),
    };

    let response = match service.serve_git(credential, &agent_user_id, request).await {
        Ok(response) => response,
        Err(error) => {
            tracing::Span::current().record("otel.status_code", "ERROR");
            let reason = match &error {
                AgentGitError::NotFound => "not_found",
                AgentGitError::InvalidToken => "invalid_token",
                AgentGitError::Forbidden(_) => "forbidden",
                AgentGitError::RepoTooLarge { .. } => "repo_too_large",
                AgentGitError::PushRateLimited => "rate_limited",
                AgentGitError::RepoBusy => "busy",
                _ => "internal",
            };
            tracing::Span::current().record("git.rejected_reason", reason);
            return AgentGitHttpError(error).into_response();
        }
    };

    let mut built = Response::new(Body::from_stream(response.body));
    *built.status_mut() =
        StatusCode::from_u16(response.status).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);

    for (name, value) in response.headers {
        let (Ok(name), Ok(value)) = (HeaderName::from_str(&name), HeaderValue::from_str(&value))
        else {
            tracing::warn!(header = %name, "dropping a malformed header from git");
            continue;
        };
        built.headers_mut().append(name, value);
    }

    built
}

#[derive(Deserialize)]
struct InfoRefsQuery {
    service: Option<String>,
}

#[tracing::instrument(skip_all, fields(repo_id = %agent_credentials::telemetry_id(repository.trim_end_matches(REPO_SUFFIX)), git.rejected_reason, otel.status_code))]
async fn info_refs<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    Path(repository): Path<String>,
    Query(query): Query<InfoRefsQuery>,
    caller: GitCredentialExtractor<Auth>,
    headers: HeaderMap,
) -> Response {
    let Some(service_name) = query.service else {
        return bad_request("dumb HTTP is not supported; use a git client with smart HTTP");
    };
    let Ok(git_service) = GitService::from_str(&service_name) else {
        return bad_request("unknown git service");
    };

    serve(
        state.service.as_ref(),
        caller.credential,
        &repository,
        GitEndpoint::InfoRefs(git_service),
        &headers,
        Body::empty(),
    )
    .await
}

#[tracing::instrument(skip_all, fields(repo_id = %agent_credentials::telemetry_id(repository.trim_end_matches(REPO_SUFFIX)), git.rejected_reason, otel.status_code))]
async fn upload_pack<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    Path(repository): Path<String>,
    caller: GitCredentialExtractor<Auth>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    serve(
        state.service.as_ref(),
        caller.credential,
        &repository,
        GitEndpoint::Rpc(GitService::UploadPack),
        &headers,
        body,
    )
    .await
}

#[tracing::instrument(skip_all, fields(repo_id = %agent_credentials::telemetry_id(repository.trim_end_matches(REPO_SUFFIX)), git.rejected_reason, otel.status_code))]
async fn receive_pack<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    Path(repository): Path<String>,
    caller: GitCredentialExtractor<Auth>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    serve(
        state.service.as_ref(),
        caller.credential,
        &repository,
        GitEndpoint::Rpc(GitService::ReceivePack),
        &headers,
        body,
    )
    .await
}

async fn lfs_unsupported() -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        [(header::CONTENT_TYPE, LFS_MEDIA_TYPE)],
        r#"{"message":"Git LFS is not supported on agent workspace repos"}"#,
    )
        .into_response()
}

#[tracing::instrument(skip_all, err)]
async fn create_repo<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(request): Json<CreateRepoRequest>,
) -> Result<Json<CreatedRepoResponse>, AgentGitHttpError> {
    let created = state
        .service
        .create_repo(request.agent_user_id, request.team_id, &request.seed)
        .await?;

    let clone_url = format!(
        "{}/{}{REPO_SUFFIX}",
        state.public_base_url,
        urlencoding::encode(created.agent_user_id.as_ref())
    );

    Ok(Json(CreatedRepoResponse {
        agent_user_id: created.agent_user_id,
        token: created.token,
        clone_url,
    }))
}

#[tracing::instrument(skip_all, err)]
async fn ensure_repo<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Json(request): Json<EnsureRepoRequest>,
) -> Result<Json<CreatedRepoResponse>, AgentGitHttpError> {
    let token = request.token;
    let created = state
        .service
        .ensure_repo(
            request.repo.agent_user_id,
            request.repo.team_id,
            &request.repo.seed,
            token,
        )
        .await?;
    let clone_url = format!(
        "{}/{}{REPO_SUFFIX}",
        state.public_base_url,
        urlencoding::encode(created.agent_user_id.as_ref())
    );
    Ok(Json(CreatedRepoResponse {
        agent_user_id: created.agent_user_id,
        token: created.token,
        clone_url,
    }))
}

#[tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref())), err)]
async fn delete_repo<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(agent_user_id): Path<String>,
) -> Result<StatusCode, AgentGitHttpError> {
    let Ok(agent_user_id) = MacroUserIdStr::try_from(agent_user_id) else {
        return Err(AgentGitHttpError(AgentGitError::NotFound));
    };

    state.service.delete_repo(&agent_user_id).await?;

    Ok(StatusCode::NO_CONTENT)
}

#[tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref())), err)]
async fn read_voice<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(agent_user_id): Path<String>,
    Query(query): Query<VoiceQuery>,
) -> Result<Json<VoiceConfig>, AgentGitHttpError> {
    let Ok(agent_user_id) = MacroUserIdStr::try_from(agent_user_id) else {
        return Err(AgentGitHttpError(AgentGitError::NotFound));
    };

    Ok(Json(
        state.service.voice(&agent_user_id, query.team_id).await?,
    ))
}

#[tracing::instrument(skip_all, fields(agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref())), err)]
async fn set_voice<Service: AgentGitService, Auth: MacroAuthorizationService>(
    State(state): State<AgentGitRouterState<Service, Auth>>,
    _internal: MacroAuthorizationExtractor<Auth, InternalOnly>,
    Path(agent_user_id): Path<String>,
    Json(request): Json<SetVoiceRequest>,
) -> Result<StatusCode, AgentGitHttpError> {
    let Ok(agent_user_id) = MacroUserIdStr::try_from(agent_user_id) else {
        return Err(AgentGitHttpError(AgentGitError::NotFound));
    };

    state
        .service
        .set_voice(&agent_user_id, request.team_id, &request.voice)
        .await?;

    Ok(StatusCode::NO_CONTENT)
}

impl std::fmt::Display for AgentGitHttpError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(formatter)
    }
}
