use crate::api::ApiContext;
use crate::api::context::AuthorizationService;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::message_reads::MessageReadError;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use sqlx::types::Uuid;
use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum GetMessageError {
    #[error("Message not found")]
    MessageNotFound,

    #[error("Unauthorized")]
    Unauthorized,

    #[error("Database query error")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetMessageError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetMessageError::MessageNotFound => StatusCode::NOT_FOUND,
            GetMessageError::Unauthorized => StatusCode::UNAUTHORIZED,
            GetMessageError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status_code.is_server_error() {
            tracing::error!(
                nested_error = ?self,
                error_type = "GetMessageError",
                variant = self.as_ref(),
                "Internal server error");
        }

        (status_code, self.to_string()).into_response()
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct PathParams {
    pub id: Uuid,
}

// TODO: deduplicate with internal api
#[utoipa::path(
    get,
    tag = "Messages",
    path = "/email/messages/{id}",
    operation_id = "get_message",
    params(
        ("id" = Uuid, Path, description = "Message ID."),
    ),
    responses(
            (status = 200, body=models_email::service::message::ParsedMessage),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(PathParams { id }): Path<PathParams>,
) -> Result<Response, GetMessageError> {
    let messages = ctx
        .message_reads
        .message(&authorization.authorization.user.user_context.user_id, id)
        .await
        .map_err(|error| match error {
            MessageReadError::NotFound => GetMessageError::MessageNotFound,
            MessageReadError::Unauthorized => GetMessageError::Unauthorized,
            MessageReadError::Messages(error) => GetMessageError::QueryError(
                error.into_inner().context("Failed to get message by id"),
            ),
            MessageReadError::Inboxes(error) => GetMessageError::QueryError(error.into_inner()),
        })?;
    Ok(Json(messages).into_response())
}

// TODO: deduplicate with internal api
#[utoipa::path(
    post,
    tag = "Messages",
    path = "/email/messages/batch",
    operation_id = "get_messages_batch",
    responses(
            (status = 200, body=Vec<models_email::service::message::ParsedMessage>),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn batch_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(ids): Json<Vec<Uuid>>,
) -> Result<Response, GetMessageError> {
    let messages = ctx
        .message_reads
        .messages(&authorization.authorization.user.user_context.user_id, &ids)
        .await
        .map_err(|error| match error {
            MessageReadError::NotFound => GetMessageError::MessageNotFound,
            MessageReadError::Unauthorized => GetMessageError::Unauthorized,
            MessageReadError::Messages(error) => GetMessageError::QueryError(
                error.into_inner().context("Failed to get messages by ids"),
            ),
            MessageReadError::Inboxes(error) => GetMessageError::QueryError(error.into_inner()),
        })?;
    Ok(Json(messages).into_response())
}
