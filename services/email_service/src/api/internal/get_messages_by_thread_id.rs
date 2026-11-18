use crate::api::{ApiContext, context::AuthorizationService};
use axum::{
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::message_reads::ThreadMessagesRequest;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;
use sqlx::types::Uuid;

/// Parameters for listing messages.
#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct ListThreadsParams {
    pub message_offset: Option<i64>,
    pub message_limit: Option<i64>,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// Internal endpoint to get a paginated email messages by thread ID.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    extract::Path(PathParams { id }): extract::Path<PathParams>,
    extract::Query(query_params): extract::Query<ListThreadsParams>,
) -> Result<Response, Response> {
    let messages = ctx
        .message_reads
        .internal_thread_messages(ThreadMessagesRequest {
            thread_id: id,
            offset: query_params.message_offset,
            limit: query_params.message_limit,
        })
        .await
        .map_err(|error| {
            let e = error.into_inner();
            tracing::error!(error=?e, "unable to list messages");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to list messages".into(),
                }),
            )
                .into_response()
        })?;
    Ok((StatusCode::OK, Json(messages)).into_response())
}
