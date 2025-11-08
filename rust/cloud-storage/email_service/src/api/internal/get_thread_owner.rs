use crate::api::context::ApiContext;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use model::response::ErrorResponse;
use models_email::service::thread::GetThreadOwnerResponse;
use uuid::Uuid;

#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    Path(thread_id): Path<Uuid>,
) -> Result<Response, Response> {
    let user_id = email_db_client::threads::get::get_macro_id_from_thread_id(&ctx.db, thread_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get owner for thread");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to get owner for thread",
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "thread not found",
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(GetThreadOwnerResponse { user_id })).into_response())
}
