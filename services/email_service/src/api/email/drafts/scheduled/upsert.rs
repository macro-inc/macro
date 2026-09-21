use crate::api::context::{ApiContext, AuthorizationService, EmailSvc};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum_extra::extract::Cached;
use email::domain::{
    models::EmailErr,
    scheduled::{EmailSchedulingService, ScheduleChange},
};
use email::inbound::axum::axum_impls::EmailLinkExtractor;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use sqlx_core::types::chrono::{DateTime, Utc};
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Debug, Error)]
#[error("{0}")]
pub struct UpsertScheduledError(#[from] EmailErr);

impl IntoResponse for UpsertScheduledError {
    fn into_response(self) -> Response {
        let status = match &self.0 {
            EmailErr::MessageNotFound(_) => StatusCode::NOT_FOUND,
            EmailErr::Unauthorized => StatusCode::FORBIDDEN,
            EmailErr::MessageDeliveryConflict(_) | EmailErr::InvalidScheduleTime => {
                StatusCode::BAD_REQUEST
            }
            _ => {
                tracing::error!(error=?self.0, "schedule transition failed");
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            "Failed to update scheduled message".to_owned()
        } else {
            self.to_string()
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize, ToSchema)]
pub struct UpsertScheduledRequest {
    /// The time to send the message (ISO 8601 format).
    pub send_time: DateTime<Utc>,
    /// Per-message signature override; absent uses the inbox's send defaults.
    pub include_signature: Option<bool>,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct UpsertScheduledResponse {
    pub message_id: Uuid,
    pub send_time: DateTime<Utc>,
}

/// Schedule or update a scheduled draft.
#[utoipa::path(
    put, tag = "Draft Scheduling", path = "/email/drafts/scheduled/{id}",
    operation_id = "upsert_scheduled_message",
    params(("id" = Uuid, Path, description = "The ID of the draft message to schedule")),
    request_body = UpsertScheduledRequest,
    responses(
        (status = 200, body = UpsertScheduledResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization, link), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Cached(authorization): Cached<
        MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    >,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<EmailSvc, AuthorizationService>>,
    Path(draft_id): Path<Uuid>,
    Json(request): Json<UpsertScheduledRequest>,
) -> Result<Json<UpsertScheduledResponse>, UpsertScheduledError> {
    ctx.email_service
        .service()
        .change_schedule(
            authorization.authorization.user.macro_user_id.clone(),
            link.id,
            draft_id,
            ScheduleChange::Set(request.send_time),
            request.include_signature,
        )
        .await?;
    Ok(Json(UpsertScheduledResponse {
        message_id: draft_id,
        send_time: request.send_time,
    }))
}
