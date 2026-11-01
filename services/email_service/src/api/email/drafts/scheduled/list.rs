use crate::api::context::ApiContext;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use models_email::service::link::Link;
use models_email::service::message::Message;
use strum_macros::AsRefStr;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};

const DEFAULT_LIMIT: u32 = 100;
const MAX_LIMIT: u32 = 1000;

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

impl GetScheduledQueryParams {
    fn validate(&self) -> Result<(), GetScheduledError> {
        if self.limit == 0 {
            return Err(GetScheduledError::Validation(
                "Limit must be positive".to_string(),
            ));
        }
        if self.limit > MAX_LIMIT {
            return Err(GetScheduledError::Validation(format!(
                "Limit must not exceed {}",
                MAX_LIMIT
            )));
        }
        Ok(())
    }
}

fn default_limit() -> u32 {
    DEFAULT_LIMIT
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
    params.validate()?;

    let messages = email_db_client::messages::scheduled::get::get_scheduled_messages_by_link_id(
        &ctx.db,
        link.id,
        params.offset,
        params.limit,
    )
    .await?;

    Ok(Json(GetScheduledResponse { messages }))
}
