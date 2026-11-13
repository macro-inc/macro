//! The read API routes (`/v1/commits`, `/v1/prs`, `/v1/blame`,
//! `/v1/sessions`), for anyone at Macro with a device credential.

use std::sync::Arc;

use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use serde_json::json;

use super::{ApiError, api_key};
use crate::domain::ports::ObjectStore;
use crate::domain::read::models::BlameQuery;
use crate::domain::read::ports::{DeviceAuthenticator, GithubApi, ReadIndex};
use crate::domain::read::service::{ReadError, ReadService};

#[cfg(test)]
mod test;

type Reader<Auth, Objects, Index, Github> = Arc<ReadService<Auth, Objects, Index, Github>>;

/// The read API's routes, without the gateway prefix. Merge them into
/// [`super::router`]'s router.
pub fn read_router<Auth, Objects, Index, Github>(
    reader: Reader<Auth, Objects, Index, Github>,
) -> Router
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    Router::new()
        .route("/v1/commits/{sha}", get(commit))
        .route("/v1/prs/macro-inc/macro/{number}", get(pull_request))
        .route("/v1/blame", get(blame))
        .route("/v1/sessions/{id}", get(session))
        .route("/v1/sessions/{id}/events", get(session_events))
        .with_state(reader)
}

/// A read failure as a response: GitHub failures are 502/503 with
/// `upstream_error`'s body, blame without a token is 501.
pub(crate) struct ReadApiError(ReadError);

impl From<ReadError> for ReadApiError {
    fn from(error: ReadError) -> Self {
        Self(error)
    }
}

impl IntoResponse for ReadApiError {
    fn into_response(self) -> Response {
        match self.0 {
            ReadError::Gitai(error) => ApiError::from(error).into_response(),
            ReadError::Github(error) => {
                tracing::warn!(error = %error, "GitHub request failed");
                error.into_response()
            }
            ReadError::BlameNeedsToken => (
                StatusCode::NOT_IMPLEMENTED,
                Json(json!({ "error": "blame_needs_github_token" })),
            )
                .into_response(),
        }
    }
}

/// `GET /v1/commits/{sha}`.
async fn commit<Auth, Objects, Index, Github>(
    State(reader): State<Reader<Auth, Objects, Index, Github>>,
    headers: HeaderMap,
    Path(sha): Path<String>,
) -> Result<impl IntoResponse, ReadApiError>
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    Ok(Json(reader.commit(api_key(&headers), &sha).await?))
}

/// `GET /v1/prs/macro-inc/macro/{number}`.
async fn pull_request<Auth, Objects, Index, Github>(
    State(reader): State<Reader<Auth, Objects, Index, Github>>,
    headers: HeaderMap,
    Path(number): Path<u64>,
) -> Result<impl IntoResponse, ReadApiError>
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    Ok(Json(reader.pull_request(api_key(&headers), number).await?))
}

#[derive(Deserialize)]
struct BlameParams {
    path: String,
    start: u32,
    end: u32,
    rev: Option<String>,
}

/// `GET /v1/blame?path=&start=&end=&rev=`.
async fn blame<Auth, Objects, Index, Github>(
    State(reader): State<Reader<Auth, Objects, Index, Github>>,
    headers: HeaderMap,
    Query(params): Query<BlameParams>,
) -> Result<impl IntoResponse, ReadApiError>
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    let query = BlameQuery {
        path: params.path,
        start: params.start,
        end: params.end,
        rev: params.rev.filter(|rev| !rev.is_empty()),
    };
    Ok(Json(reader.blame(api_key(&headers), query).await?))
}

/// `GET /v1/sessions/{id}`.
async fn session<Auth, Objects, Index, Github>(
    State(reader): State<Reader<Auth, Objects, Index, Github>>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<impl IntoResponse, ReadApiError>
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    Ok(Json(reader.session(api_key(&headers), &id).await?))
}

#[derive(Deserialize)]
struct EventsParams {
    from: Option<String>,
    limit: Option<usize>,
}

/// `GET /v1/sessions/{id}/events?from=&limit=`.
async fn session_events<Auth, Objects, Index, Github>(
    State(reader): State<Reader<Auth, Objects, Index, Github>>,
    headers: HeaderMap,
    Path(id): Path<String>,
    Query(params): Query<EventsParams>,
) -> Result<impl IntoResponse, ReadApiError>
where
    Auth: DeviceAuthenticator,
    Objects: ObjectStore,
    Index: ReadIndex,
    Github: GithubApi,
{
    let page = reader
        .session_events(
            api_key(&headers),
            &id,
            params.from.as_deref().filter(|from| !from.is_empty()),
            params.limit,
        )
        .await?;
    Ok(Json(page))
}
