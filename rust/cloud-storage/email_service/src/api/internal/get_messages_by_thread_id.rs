use crate::api::ApiContext;
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use model::response::ErrorResponse;
use sqlx::types::Uuid;

/// Parameters for listing messages.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct ListThreadsParams {
    pub message_offset: Option<i64>,
    pub message_limit: Option<i64>,
}

/// The default number of messages to return in each thread
const DEFAULT_MESSAGE_LIMIT: i64 = 5;
/// The max number of messages that can be returned in a response
const MESSAGE_MAX: i64 = 100;

/// Represents pagination parameters with defaults applied
#[derive(Debug, Clone, Copy)]
struct ListThreadsPaginationParams {
    message_offset: i64,
    message_limit: i64,
}

impl From<ListThreadsParams> for ListThreadsPaginationParams {
    fn from(params: ListThreadsParams) -> Self {
        ListThreadsPaginationParams {
            message_offset: params
                .message_offset
                .filter(|&offset| offset >= 0)
                .unwrap_or(0),

            message_limit: params
                .message_limit
                .filter(|&limit| 0 < limit && limit <= MESSAGE_MAX)
                .unwrap_or(DEFAULT_MESSAGE_LIMIT),
        }
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// Internal endpoint to get a paginated email messages by thread ID.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Path(PathParams { id }): extract::Path<PathParams>,
    extract::Query(query_params): extract::Query<ListThreadsParams>,
) -> Result<Response, Response> {
    let p: ListThreadsPaginationParams = query_params.into();

    let messages =
        email_db_client::messages::get_parsed::get_paginated_parsed_messages_by_thread_id(
            &ctx.db,
            id,
            p.message_offset,
            p.message_limit,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to list messages");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to list messages",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(messages)).into_response())
}
