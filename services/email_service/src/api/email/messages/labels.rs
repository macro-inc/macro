use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::message_labels::{
    MAX_MESSAGE_LABEL_BATCH, MessageLabelChange, MessageLabelError, StageFailure,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use std::borrow::Cow;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UpdateLabelBatchRequest {
    pub message_ids: Vec<Uuid>,
    pub label_id: Uuid,
    pub value: bool,
}

// Response body for updating a flag for a batch of messages.
#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct UpdateLabelBatchResponse {
    pub successful_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
    pub missing_ids: Vec<Uuid>,
}

/// Add or remove a label from a batch of messages
#[utoipa::path(
    patch,
    tag = "Messages",
    path = "/email/messages/labels",
    operation_id = "add_remove_label",
    request_body = UpdateLabelBatchRequest,
    responses(
            (status = 200, body=UpdateLabelBatchResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, body), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Json(body): Json<UpdateLabelBatchRequest>,
) -> Result<Response, Response> {
    let outcome = ctx
        .message_labels
        .change(MessageLabelChange {
            caller_macro_id: authorization.authorization.user.user_context.user_id,
            caller_fusionauth_user_id: authorization.authorization.user.user_context.fusion_user_id,
            message_ids: body.message_ids,
            label_id: body.label_id,
            add: body.value,
        })
        .await
        .map_err(error_response)?;

    Ok((
        StatusCode::OK,
        Json(UpdateLabelBatchResponse {
            successful_ids: outcome.successful_ids,
            failed_ids: outcome.failed_ids,
            missing_ids: outcome.missing_ids,
        }),
    )
        .into_response())
}

fn error_response<E>(error: MessageLabelError<E>) -> Response {
    let (status, message): (_, Cow<'static, str>) = match error {
        MessageLabelError::BatchSize => (
            StatusCode::BAD_REQUEST,
            format!("Must include between 1 and {MAX_MESSAGE_LABEL_BATCH} message IDs in request")
                .into(),
        ),
        MessageLabelError::InboxLookup(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to resolve inbox for messages".into(),
        ),
        MessageLabelError::MessageNotFound => (StatusCode::NOT_FOUND, "message not found".into()),
        MessageLabelError::LabelLookup(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to fetch label from db".into(),
        ),
        MessageLabelError::LabelNotFound => (StatusCode::BAD_REQUEST, "label not found".into()),
        MessageLabelError::MessagesLookup(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to fetch messages from db".into(),
        ),
        MessageLabelError::Stage(StageFailure::Begin) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to begin transaction".into(),
        ),
        MessageLabelError::Stage(StageFailure::Change) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to update labels in database".into(),
        ),
        MessageLabelError::Stage(StageFailure::Commit) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to commit transaction".into(),
        ),
        MessageLabelError::Unqueued(_) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to queue the label change".into(),
        ),
    };
    (status, Json(ErrorResponse { message })).into_response()
}
