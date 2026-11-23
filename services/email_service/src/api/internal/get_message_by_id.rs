use crate::api::{ApiContext, context::AuthorizationService};
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::message_reads::InternalMessageReadError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;
use sqlx::types::Uuid;

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

/// Internal endpoint to get an email message by ID.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Path(PathParams { id }): Path<PathParams>,
) -> Result<Response, Response> {
    let messages = ctx
        .message_reads
        .internal_message(id)
        .await
        .map_err(|error| {
            let (status, message) = match error {
                InternalMessageReadError::NotFound => (StatusCode::NOT_FOUND, "message not found"),
                InternalMessageReadError::Query(error) => {
                    let e = error.into_inner();
                    tracing::error!(error=?e, "unable to get message ids for thread");
                    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
                }
            };
            (
                status,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        })?;
    Ok(Json(messages).into_response())
}

#[tracing::instrument(skip(ctx))]
pub async fn get_message_by_id_batch_handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Response, Response> {
    let messages = ctx
        .message_reads
        .internal_messages(&ids)
        .await
        .map_err(|error| {
            let (status, message) = match error {
                InternalMessageReadError::NotFound => (StatusCode::NOT_FOUND, "messages not found"),
                InternalMessageReadError::Query(error) => {
                    let e = error.into_inner();
                    tracing::error!(error=?e, "unable to get message ids for thread");
                    (StatusCode::INTERNAL_SERVER_ERROR, "internal server error")
                }
            };
            (
                status,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        })?;
    Ok(Json(messages).into_response())
}
