use axum::{
    extract::State,
    response::{IntoResponse, Json, Response},
};
use model::response::EmptyResponse;
use models_comms::mentions::DeleteMentionsRequest;
use reqwest::StatusCode;
use sqlx::PgPool;

#[tracing::instrument(skip(db))]
pub async fn handler(
    State(db): State<PgPool>,
    Json(req): Json<DeleteMentionsRequest>,
) -> Result<Response, Response> {
    tracing::trace!(
        "deleting mentions with source_entity_ids {}",
        req.item_ids.join(",")
    );

    comms_db_client::entity_mentions::delete_entity_mentions_by_source(&db, req.item_ids)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to delete entity mentions by source");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "failed to delete entity mentions by source".to_string(),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
