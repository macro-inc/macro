use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{self, FromRef, State},
    http::StatusCode,
    response::IntoResponse,
    routing::get,
};
use entity_access::domain::models::{EntityPermission, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ThreadAccessLevelExtractor;
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::api_types::{ApiThread, GetThreadParams, GetThreadResponse};

/// The default number of messages to return per page.
const DEFAULT_MESSAGE_LIMIT: i64 = 5;
/// The maximum number of messages that can be returned per request.
const MESSAGE_MAX: i64 = 100;

pub struct EmailThreadRouterState<T, Svc> {
    pub service: Arc<T>,
    pub access_service: Arc<Svc>,
}

impl<T, Svc> Clone for EmailThreadRouterState<T, Svc> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
        }
    }
}

impl<T, Svc> FromRef<EmailThreadRouterState<T, Svc>> for Arc<Svc> {
    fn from_ref(state: &EmailThreadRouterState<T, Svc>) -> Self {
        state.access_service.clone()
    }
}

pub fn thread_router<S, T, Svc>(state: EmailThreadRouterState<T, Svc>) -> Router<S>
where
    S: Send + Sync + 'static,
    T: EmailService,
    Svc: EntityAccessService,
{
    Router::new()
        .route("/:thread_id", get(get_thread_handler::<T, Svc>))
        .with_state(state)
}

#[derive(Debug, Error)]
pub enum GetThreadError {
    #[error("Thread not found")]
    NotFound,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Internal error")]
    Internal(#[from] EmailErr),
}

impl IntoResponse for GetThreadError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, GetThreadError::Internal(_)) {
            tracing::error!(error=?self, "get thread error");
        }

        let status = match &self {
            GetThreadError::NotFound => StatusCode::NOT_FOUND,
            GetThreadError::Validation(_) => StatusCode::BAD_REQUEST,
            GetThreadError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (status, Json(ErrorResponse { message: &message })).into_response()
    }
}

/// Get a thread with paginated messages.
#[utoipa::path(
    get,
    tag = "Threads",
    path = "/email/threads/{thread_id}",
    operation_id = "get_thread",
    params(
        ("thread_id" = String, Path, description = "Thread ID"),
        ("offset" = Option<i64>, Query, description = "Offset for message pagination. Default is 0."),
        ("limit" = Option<i64>, Query, description = "Limit for message pagination. Default is 5, max 100."),
    ),
    responses(
        (status = 200, body = GetThreadResponse),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, access))]
pub async fn get_thread_handler<T: EmailService, Svc: EntityAccessService>(
    State(state): State<EmailThreadRouterState<T, Svc>>,
    access: ThreadAccessLevelExtractor<ViewAccessLevel, Svc>,
    extract::Query(params): extract::Query<GetThreadParams>,
) -> Result<Json<GetThreadResponse>, GetThreadError> {
    let (offset, limit) = parse_pagination_params(&params)?;

    let access_level = match access.entity_access_receipt.entity_permission() {
        EntityPermission::AccessLevel { access_level } => *access_level,
        _ => unreachable!("thread permissions should always be access level"),
    };

    let thread = state
        .service
        .get_thread_with_messages(access.entity_access_receipt, offset, limit)
        .await?
        .ok_or(GetThreadError::NotFound)?;

    Ok(Json(GetThreadResponse {
        thread: ApiThread::from_thread(thread, access_level),
    }))
}

fn parse_pagination_params(params: &GetThreadParams) -> Result<(i64, i64), GetThreadError> {
    if let Some(offset) = params.offset
        && offset < 0
    {
        return Err(GetThreadError::Validation(
            "offset must be non-negative".to_string(),
        ));
    }

    if let Some(limit) = params.limit {
        if limit <= 0 {
            return Err(GetThreadError::Validation(
                "limit must be positive".to_string(),
            ));
        }
        if limit > MESSAGE_MAX {
            return Err(GetThreadError::Validation(format!(
                "limit must not exceed {MESSAGE_MAX}"
            )));
        }
    }

    Ok((
        params.offset.unwrap_or(0),
        params.limit.unwrap_or(DEFAULT_MESSAGE_LIMIT),
    ))
}
