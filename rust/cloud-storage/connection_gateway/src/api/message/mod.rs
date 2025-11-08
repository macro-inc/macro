use crate::model::message::UniqueMessage;
use crate::{
    context::AppState,
    model::{message::Message, sender::MessageReceipt},
    service::sender::send_message_to_entity,
};
use anyhow::Result;
use axum::{
    Json as JsonResponse, Router,
    extract::{Json, Path, State},
    http::StatusCode,
    routing::post,
};
use futures::future::try_join_all;
use macro_middleware::auth;
use model_entity::Entity;
use std::time::Instant;
use utoipa::ToSchema;

pub fn router<S>(state: AppState) -> Router<S>
where
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/send/:entity_type/:entity_id", post(send_message_handler))
        .route("/batch_send", post(batch_send_message_handler))
        .route(
            "/batch_send_unique",
            post(batch_send_unique_messages_handler),
        )
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::internal_access::handler,
        ))
        .with_state(state)
}

#[derive(serde::Serialize, Debug, ToSchema)]
pub struct SendMessageResponse {
    pub receipts: Vec<MessageReceipt>,
}

#[derive(serde::Deserialize, serde::Serialize, Debug, ToSchema)]
pub struct SendMessageBody {
    pub message: serde_json::Value,
    pub message_type: String,
}

#[utoipa::path(
        post,
        path = "/message/send/{entity_type}/{entity_id}",
        params(
            ("entity_type" = String, Path, description = "the type of the entity to send the msssage to e.g. \"user\" | \"channel\" | \"document\" etc..."),
            ("entity_id" = String, Path, description = "the id of the entity to send the message to"),
        ),
        responses(
            (status = 201, body=SendMessageResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx))]
#[axum::debug_handler(state = AppState)]
pub async fn send_message_handler(
    State(ctx): State<AppState>,
    Path(entity): Path<Entity<'static>>,
    Json(body): Json<SendMessageBody>,
) -> Result<(StatusCode, JsonResponse<SendMessageResponse>), (StatusCode, String)> {
    let res = send_message_to_entity(
        &ctx,
        &entity,
        Message {
            message_type: body.message_type.clone(),
            data: body.message.to_string(),
        },
    )
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to send message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to send message".to_string(),
        )
    })?;

    Ok((
        StatusCode::OK,
        JsonResponse(SendMessageResponse { receipts: res }),
    ))
}

#[derive(serde::Deserialize, serde::Serialize, Debug, ToSchema)]
pub struct BatchSendMessageBody<'a> {
    /// the message to send
    pub message: serde_json::Value,
    /// all entities to send the message to
    pub entities: Vec<Entity<'a>>,
    /// the type of the message we are sending
    pub message_type: String,
}

#[utoipa::path(
    post,
    path = "/batch_send",
    request_body = BatchSendMessageBody,
    responses(
        (status = 200, description = "Message sent successfully", body = SendMessageResponse),
        (status = 500, description = "Internal server error", body = String),
    )
)]
#[tracing::instrument(skip(ctx))]
pub async fn batch_send_message_handler(
    State(ctx): State<AppState>,
    Json(body): Json<BatchSendMessageBody<'static>>,
) -> Result<(StatusCode, JsonResponse<SendMessageResponse>), (StatusCode, String)> {
    let now = Instant::now();

    let all_receipts = try_join_all(body.entities.iter().map(|entity| {
        send_message_to_entity(
            &ctx,
            entity,
            Message {
                message_type: body.message_type.clone(),
                data: body.message.to_string(),
            },
        )
    }))
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to send message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to send message".to_string(),
        )
    })?;

    tracing::trace!("batch send message took {:?}", now.elapsed());

    Ok((
        StatusCode::OK,
        JsonResponse(SendMessageResponse {
            receipts: all_receipts.into_iter().flatten().collect(),
        }),
    ))
}

#[derive(serde::Deserialize, serde::Serialize, Debug, ToSchema)]
pub struct BatchSendUniqueMessagesBody {
    pub messages: Vec<UniqueMessage>,
}

// Send unique (different) messages to multiple entities
#[utoipa::path(
    post,
    path = "/batch_send_unique",
    request_body = BatchSendUniqueMessagesBody,
    responses(
        (status = 200, description = "Messages sent successfully", body = SendMessageResponse),
        (status = 500, description = "Internal server error", body = String),
    )
)]
#[tracing::instrument(skip(ctx))]
#[axum::debug_handler(state = AppState)]
pub async fn batch_send_unique_messages_handler(
    State(ctx): State<AppState>,
    Json(body): Json<BatchSendUniqueMessagesBody>,
) -> Result<(StatusCode, JsonResponse<SendMessageResponse>), (StatusCode, String)> {
    let now = Instant::now();

    let all_receipts = try_join_all(body.messages.iter().map(|message| {
        send_message_to_entity(
            &ctx,
            &message.entity,
            Message {
                message_type: message.message_type.clone(),
                data: message.message_content.to_string(),
            },
        )
    }))
    .await
    .map_err(|e| {
        tracing::error!(error=?e, "unable to send message");
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "unable to send message".to_string(),
        )
    })?;

    tracing::trace!("batch send unique message took {:?}", now.elapsed());

    Ok((
        StatusCode::OK,
        JsonResponse(SendMessageResponse {
            receipts: all_receipts.into_iter().flatten().collect(),
        }),
    ))
}
