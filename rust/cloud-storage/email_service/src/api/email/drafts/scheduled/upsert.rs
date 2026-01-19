use crate::api::context::ApiContext;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use models_email::service::message::ScheduledMessage;
use sqlx_core::types::chrono::{DateTime, Utc};
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error, AsRefStr)]
pub enum UpsertScheduledError {
    #[error("Draft not found")]
    NotFound,

    #[error("Failed to upsert scheduled message")]
    QueryError(#[from] anyhow::Error),

    #[error("Database error")]
    DatabaseError(#[from] sqlx::Error),
}

impl IntoResponse for UpsertScheduledError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            UpsertScheduledError::NotFound => StatusCode::NOT_FOUND,
            UpsertScheduledError::QueryError(_) | UpsertScheduledError::DatabaseError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().as_str(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct UpsertScheduledRequest {
    /// The time to send the message (ISO 8601 format)
    pub send_time: DateTime<Utc>,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct UpsertScheduledResponse {
    pub message_id: Uuid,
    pub send_time: DateTime<Utc>,
}

/// Schedule or update a scheduled draft.
#[utoipa::path(
    put,
    tag = "Draft Scheduling",
    path = "/email/drafts/scheduled/{id}",
    operation_id = "upsert_scheduled_message",
    params(
        ("id" = Uuid, Path, description = "The ID of the draft message to schedule")
    ),
    request_body = UpsertScheduledRequest,
    responses(
        (status = 200, body = UpsertScheduledResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Path(draft_id): Path<Uuid>,
    Json(request): Json<UpsertScheduledRequest>,
) -> Result<Json<UpsertScheduledResponse>, UpsertScheduledError> {
    // Check if the draft exists
    let draft_exists =
        email_db_client::messages::get::draft_exists_with_id(&ctx.db, link.id, draft_id).await?;

    if !draft_exists {
        return Err(UpsertScheduledError::NotFound);
    }

    // Create the scheduled message
    let scheduled_message = ScheduledMessage {
        link_id: link.id,
        message_id: draft_id,
        send_time: request.send_time,
        sent: false,
        processing: false,
    };

    // Upsert the scheduled message
    let mut tx = ctx.db.begin().await?;
    email_db_client::messages::scheduled::upsert::upsert_scheduled_message(
        &mut tx,
        scheduled_message,
    )
    .await?;
    tx.commit().await?;

    Ok(Json(UpsertScheduledResponse {
        message_id: draft_id,
        send_time: request.send_time,
    }))
}
