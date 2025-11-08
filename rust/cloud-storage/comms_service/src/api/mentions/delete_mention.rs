use crate::api::context::DocumentPermissionJwtSecretKey;
use axum::{
    Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use comms_db_client::entity_mentions::{
    delete_entity_mention_by_id::delete_entity_mention_by_id,
    get_entity_mention_by_id::get_entity_mention_by_id,
};
use secretsmanager_client::LocalOrRemoteSecret;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use super::mentions_middleware::validate_mention_edit_permission;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DeleteEntityMentionRequest {
    pub entity_mention_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct DeleteEntityMentionResponse {
    pub deleted: bool,
}

#[utoipa::path(
    delete,
    path = "/mentions/{mention_id}",
    params(
        ("mention_id" = String, Path, description = "UUID of the entity mention to delete")
    ),
    responses(
        (status = 200, description = "Entity mention deleted successfully", body = DeleteEntityMentionResponse),
        (status = 400, description = "Invalid request parameters"),
        (status = 403, description = "Insufficient permissions"),
        (status = 404, description = "Entity mention not found"),
        (status = 500, description = "Internal server error")
    ),
    tag = "mentions"
)]
#[tracing::instrument(skip(db, secret))]
pub async fn delete_mention_handler(
    State(db): State<PgPool>,
    State(secret): State<LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>>,

    headers: HeaderMap,
    axum::extract::Path(entity_mention_id): axum::extract::Path<String>,
) -> Result<Response, Response> {
    let mention_id = Uuid::parse_str(&entity_mention_id)
        .map_err(|_| (StatusCode::BAD_REQUEST, "invalid entity mention ID").into_response())?;

    let entity_mention = get_entity_mention_by_id(&db, mention_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch entity mention: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR).into_response()
        })?
        .ok_or_else(|| (StatusCode::NOT_FOUND, "entity mention not found").into_response())?;

    validate_mention_edit_permission(
        &headers,
        secret,
        &entity_mention.source_entity_type,
        &entity_mention.source_entity_id,
    )
    .await?;

    let deleted = delete_entity_mention_by_id(&db, mention_id)
        .await
        .map_err(|e| {
            tracing::error!("Failed to delete entity mention: {:?}", e);
            (StatusCode::INTERNAL_SERVER_ERROR).into_response()
        })?;

    if !deleted {
        return Err(StatusCode::NOT_FOUND.into_response());
    }

    Ok((
        StatusCode::OK,
        Json(DeleteEntityMentionResponse { deleted }),
    )
        .into_response())
}
