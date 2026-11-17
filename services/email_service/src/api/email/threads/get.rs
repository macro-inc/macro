use crate::api::context::{ApiContext, AuthorizationService};
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Json, extract};
use email::domain::message_reads::{ThreadMessagesRequest, ThreadReadError};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;

#[derive(Debug, Error, AsRefStr)]
pub enum GetThreadError {
    #[error("Unable to get messages")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Database query error")]
    QueryError(#[from] sqlx::Error),

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Validation error: {0}")]
    ValidationError(String),
}

impl IntoResponse for GetThreadError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetThreadError::Unauthorized => StatusCode::UNAUTHORIZED,
            GetThreadError::ValidationError(_) => StatusCode::BAD_REQUEST,
            GetThreadError::DatabaseError(_) | GetThreadError::QueryError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Parameters for getting messages. The number of messages is paginated, returning the latest updated first.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct GetThreadMessagesParams {
    pub offset: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
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
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id), err)]
pub async fn get_thread_messages_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(PathParams { id }): Path<PathParams>,
    extract::Query(query_params): extract::Query<GetThreadMessagesParams>,
) -> Result<Response, GetThreadError> {
    let messages = ctx
        .message_reads
        .thread_messages(
            &authorization.authorization.user.user_context.user_id,
            ThreadMessagesRequest {
                thread_id: id,
                offset: query_params.offset,
                limit: query_params.limit,
            },
        )
        .await
        .map_err(|error| match error {
            ThreadReadError::Validation(error) => {
                GetThreadError::ValidationError(error.to_string())
            }
            ThreadReadError::Unauthorized => GetThreadError::Unauthorized,
            ThreadReadError::Inboxes(error) => {
                GetThreadError::DatabaseError(error.into_inner().context("Failed to fetch links"))
            }
            ThreadReadError::Messages(error) => GetThreadError::DatabaseError(
                error
                    .into_inner()
                    .context("Failed to get paginated parsed messages by thread id"),
            ),
        })?;
    Ok((StatusCode::OK, Json(messages)).into_response())
}
