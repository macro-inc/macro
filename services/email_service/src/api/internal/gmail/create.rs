use crate::api::{ApiContext, context::AuthorizationService};
use axum::{
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::backfill_jobs::BackfillCreateError;
use macro_authorization::{InternalOnly, MacroAuthorizationExtractor};
use model::response::ErrorResponse;
use sqlx::types::Uuid;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct BackfillParams {
    pub link_ids: Vec<Uuid>,
    pub num_threads: Option<i32>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct BackfillResponse {
    pub pairs: Vec<LinkJobPair>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct LinkJobPair {
    pub link_id: Uuid,
    pub job_id: Uuid,
}

/// Internal endpoint to backfill email threads for users.
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    _: MacroAuthorizationExtractor<AuthorizationService, InternalOnly>,
    Json(req_body): Json<BackfillParams>,
) -> Result<Response, Response> {
    let pairs = ctx
        .backfill_jobs
        .create(req_body.link_ids, req_body.num_threads)
        .await
        .map_err(create_error_response)?;
    Ok((
        StatusCode::OK,
        Json(BackfillResponse {
            pairs: pairs
                .into_iter()
                .map(|(link_id, job_id)| LinkJobPair { link_id, job_id })
                .collect(),
        }),
    )
        .into_response())
}

fn create_error_response<E, Q>(error: BackfillCreateError<E, Q>) -> Response {
    let (status, message) = match error {
        BackfillCreateError::InboxLookup { link_id, .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("error fetching link for id {}", link_id),
        ),
        BackfillCreateError::InboxNotFound(_) => (
            StatusCode::BAD_REQUEST,
            "link id does not exist".to_string(),
        ),
        BackfillCreateError::SyncDisabled(link_id) => (
            StatusCode::BAD_REQUEST,
            format!("sync must be enabled for link {}", link_id),
        ),
        BackfillCreateError::Insert { link_id, .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("error creating backfill job for link {}", link_id),
        ),
        BackfillCreateError::ActiveLookup { link_id, .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("error fetching active backfill job for link {}", link_id),
        ),
        BackfillCreateError::MissingActive(link_id) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("backfill conflict but no active job for link {}", link_id),
        ),
        BackfillCreateError::Queue { link_id, .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to enqueue backfill message for link {}", link_id),
        ),
        BackfillCreateError::Cleanup { link_id, .. } => (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to clean up backfill job for link {}", link_id),
        ),
    };
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}
