use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, extract};
use futures::future::join_all;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::thread;
use models_email::service::link::Link;
use models_email::service::message::MessageWithBodyReplyless;
use models_email::service::thread::APIThread;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum GetThreadError {
    #[error("Thread not found")]
    ThreadNotFound,

    #[error("Unable to get messages")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Database query error")]
    QueryError(#[from] sqlx::Error),

    #[error("Unauthorized")]
    Unauthorized,
}

impl IntoResponse for GetThreadError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetThreadError::ThreadNotFound => StatusCode::NOT_FOUND,
            GetThreadError::Unauthorized => StatusCode::UNAUTHORIZED,
            GetThreadError::DatabaseError(_) | GetThreadError::QueryError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetThreadError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

/// Parameters for getting messages. The number of messages is paginated, returning the latest updated first.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetThreadParams {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

/// The response returned from the get thread endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetThreadResponse {
    /// the thread, with messages inside
    pub thread: thread::APIThread,
}

/// Represents pagination parameters with defaults applied
#[derive(Debug, Clone, Copy)]
struct GetThreadPaginationParams {
    offset: i64,
    limit: i64,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// The default number of messages to return in each thread
const DEFAULT_MESSAGE_LIMIT: i64 = 5;
/// The max number of messages that can be returned in a response
const MESSAGE_MAX: i64 = 100;

/// Get a thread with a paginated number of messages.
#[utoipa::path(
    get,
    tag = "Threads",
    path = "/email/threads/{id}",
    operation_id = "get_thread",
    params(
        ("id" = Uuid, Path, description = "Thread ID."),
        ("offset" = i64, Query, description = "Offset for message pagination. Default is 0."),
        ("limit" = i64, Query, description = "Limit for message pagination. Default is 5."),
    ),


    responses(
            (status = 200, body=GetThreadResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn get_thread_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Path(PathParams { id: thread_id }): Path<PathParams>,
    extract::Query(query_params): extract::Query<GetThreadParams>,
) -> Result<Response, GetThreadError> {
    let p = process_get_thread_params(&query_params);

    let thread = email_db_client::threads::get::fetch_thread_with_messages_paginated(
        &ctx.db, thread_id, p.offset, p.limit,
    )
    .await
    .context("Failed to fetch thread with messages")?;

    // Check if thread was found
    if thread.db_id.is_none() {
        return Err(GetThreadError::ThreadNotFound);
    }

    // if the requester doesn't own the thread, check if it has been shared with the requester
    if thread.link_id != link.id {
        // call will fail if user doesn't have an access level. otherwise, we can return the thread
        ctx.dss_client
            .get_thread_access_level(&link.macro_id, &thread.db_id.unwrap().to_string())
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to get access level for thread for user");
                GetThreadError::ThreadNotFound
            })?;
    }

    let tasks: Vec<_> = thread
        .clone()
        .messages
        .into_iter()
        .map(|message| async move { MessageWithBodyReplyless::from(message) })
        .collect();

    let result: Vec<MessageWithBodyReplyless> = join_all(tasks).await;

    let api_thread = APIThread::from_thread_with_messages(thread, result);

    Ok((
        StatusCode::OK,
        Json(GetThreadResponse { thread: api_thread }),
    )
        .into_response())
}

// TODO: deduplicate with internal api
#[utoipa::path(
    get,
    tag = "Threads",
    path = "/email/threads/{id}/messages",
    params(
        ("id" = String, Path, description = "Thread ID"),
        ("since" = Option<DateTime<Utc>>, Query, description = "Filter messages after this date"),
        ("limit" = Option<i64>, Query, description = "Limit number of messages returned"),
    ),
    responses(
        (status = 200, description = "OK", body = Vec<models_email::service::message::ParsedMessage>),
        (status = 400, description = "Bad Request", body = ErrorResponse),
        (status = 401, description = "Unauthorized", body = ErrorResponse),
        (status = 404, description = "Not Found", body = ErrorResponse),
        (status = 500, description = "Internal Server Error", body = ErrorResponse),
    ),
)]
#[tracing::instrument(skip(ctx, user_context, link), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id, link_id=%link.id))]
pub async fn get_thread_messages_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    link: Extension<Link>,
    Path(PathParams { id }): Path<PathParams>,
    extract::Query(query_params): extract::Query<GetThreadParams>,
) -> Result<Response, GetThreadError> {
    let p = process_get_thread_params(&query_params);

    let messages =
        email_db_client::messages::get_parsed::get_paginated_parsed_messages_by_thread_id(
            &ctx.db, id, p.offset, p.limit,
        )
        .await
        .context("Failed to get paginated parsed messages by thread id")?;

    let accessible_messages = messages
        .into_iter()
        .filter(|msg| msg.link_id == link.id)
        .collect::<Vec<_>>();

    if accessible_messages.is_empty() {
        return Err(GetThreadError::Unauthorized);
    }

    Ok((StatusCode::OK, Json(accessible_messages)).into_response())
}

/// Extracts pagination parameters from query params, using defaults when not specified
fn process_get_thread_params(params: &GetThreadParams) -> GetThreadPaginationParams {
    GetThreadPaginationParams {
        offset: params.offset.filter(|&offset| offset >= 0).unwrap_or(0),

        limit: params
            .limit
            .filter(|&limit| 0 < limit && limit <= MESSAGE_MAX)
            .unwrap_or(DEFAULT_MESSAGE_LIMIT),
    }
}
