use crate::api::context::ApiContext;
use anyhow::Context;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json, extract};
use model::response::ErrorResponse;
use model::user::UserContext;
use sqlx::types::Uuid;
use std::collections::HashSet;
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id), err)]
pub async fn get_thread_messages_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    Path(PathParams { id }): Path<PathParams>,
    extract::Query(query_params): extract::Query<GetThreadMessagesParams>,
) -> Result<Response, GetThreadError> {
    let p = process_get_thread_params(&query_params)?;

    let link_ids: HashSet<Uuid> = email_db_client::links::get::fetch_links_by_fusionauth_user_id(
        &ctx.db,
        &user_context.fusion_user_id,
    )
    .await
    .context("Failed to fetch links")?
    .into_iter()
    .map(|link| link.id)
    .collect();

    let messages =
        email_db_client::messages::get_parsed::get_paginated_parsed_messages_by_thread_id(
            &ctx.db, id, p.offset, p.limit,
        )
        .await
        .context("Failed to get paginated parsed messages by thread id")?;

    let accessible_messages = messages
        .into_iter()
        .filter(|msg| link_ids.contains(&msg.link_id))
        .collect::<Vec<_>>();

    if accessible_messages.is_empty() {
        return Err(GetThreadError::Unauthorized);
    }

    Ok((StatusCode::OK, Json(accessible_messages)).into_response())
}

/// Extracts pagination parameters from query params, using defaults when not specified
fn process_get_thread_params(
    params: &GetThreadMessagesParams,
) -> Result<GetThreadPaginationParams, GetThreadError> {
    if let Some(offset) = params.offset
        && offset < 0
    {
        return Err(GetThreadError::ValidationError(
            "offset must be non-negative".to_string(),
        ));
    }

    if let Some(limit) = params.limit {
        if limit <= 0 {
            return Err(GetThreadError::ValidationError(
                "limit must be positive".to_string(),
            ));
        }
        if limit > MESSAGE_MAX {
            return Err(GetThreadError::ValidationError(format!(
                "limit must not exceed {}",
                MESSAGE_MAX
            )));
        }
    }

    Ok(GetThreadPaginationParams {
        offset: params.offset.unwrap_or(0),
        limit: params.limit.unwrap_or(DEFAULT_MESSAGE_LIMIT),
    })
}
