use crate::api::context::ApiContext;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use email::domain::scheduled::drafts::{DEFAULT_SCHEDULED_LIMIT, ScheduledDraftError};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use models_email::service::message::Message;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};

#[derive(Debug, Error, AsRefStr)]
pub enum GetScheduledError {
    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Failed to fetch scheduled messages")]
    QueryError(#[from] anyhow::Error),
}

impl IntoResponse for GetScheduledError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            GetScheduledError::Validation(_) => StatusCode::BAD_REQUEST,
            GetScheduledError::QueryError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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

#[derive(Debug, serde::Serialize, serde::Deserialize, IntoParams)]
pub struct GetScheduledQueryParams {
    /// The number of scheduled messages to skip.
    #[serde(default)]
    pub offset: u32,
    /// The maximum number of scheduled messages to return.
    #[serde(default = "default_limit")]
    pub limit: u32,
}

fn default_limit() -> u32 {
    DEFAULT_SCHEDULED_LIMIT
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct GetScheduledResponse {
    pub messages: Vec<Message>,
}

/// List scheduled drafts.
#[utoipa::path(
    get,
    tag = "Draft Scheduling",
    path = "/email/drafts/scheduled",
    operation_id = "get_scheduled_messages",
    params(GetScheduledQueryParams),
    responses(
        (status = 200, body = GetScheduledResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    link: Extension<Link>,
    Query(params): Query<GetScheduledQueryParams>,
) -> Result<Json<GetScheduledResponse>, GetScheduledError> {
    let messages = ctx
        .scheduled_drafts
        .list(link.id, params.offset, params.limit)
        .await
        .map_err(|error| match error {
            ScheduledDraftError::NonPositiveLimit => {
                GetScheduledError::Validation("Limit must be positive".to_string())
            }
            ScheduledDraftError::ExcessiveLimit(maximum) => {
                GetScheduledError::Validation(format!("Limit must not exceed {}", maximum))
            }
            ScheduledDraftError::Query(error) => GetScheduledError::QueryError(error.into_inner()),
        })?;

    Ok(Json(GetScheduledResponse { messages }))
}
