use crate::api::context::{AppState, DocumentPermissionJwtSecretKey};
use axum::{
    Extension, Json,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use axum_macros::debug_handler;
use comms_db_client::entity_mentions::create_entity_mention::{
    CreateEntityMentionOptions, create_entity_mention,
};
use model::user::UserContext;
use secretsmanager_client::LocalOrRemoteSecret;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;

use super::mentions_middleware::validate_mention_edit_permission;

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateEntityMentionRequest {
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct CreateEntityMentionResponse {
    pub id: String,
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[utoipa::path(
    post,
    path = "/mentions",
    request_body = CreateEntityMentionRequest,
    responses(
        (status = 201, description = "Entity mention created successfully", body = CreateEntityMentionResponse),
        (status = 400, description = "Invalid request parameters"),
        (status = 500, description = "Internal server error")
    ),
    tag = "mentions"
)]
#[tracing::instrument(skip(db, config, user_context))]
#[debug_handler(state = AppState)]
pub async fn create_mention_handler(
    State(db): State<PgPool>,
    State(config): State<LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>>,
    Extension(user_context): Extension<UserContext>,
    headers: HeaderMap,
    Json(data): Json<CreateEntityMentionRequest>,
) -> Result<Response, Response> {
    validate_mention_edit_permission(
        &headers,
        config,
        &data.source_entity_type,
        &data.source_entity_id,
    )
    .await?;

    let entity_mention = create_entity_mention(
        &db,
        CreateEntityMentionOptions {
            source_entity_type: data.source_entity_type,
            source_entity_id: data.source_entity_id,
            entity_type: data.entity_type,
            entity_id: data.entity_id,
            user_id: Some(user_context.user_id.clone()),
        },
    )
    .await
    .map_err(|e| {
        tracing::error!("Failed to create entity mention: {:?}", e);
        (StatusCode::INTERNAL_SERVER_ERROR).into_response()
    })?;

    Ok((
        StatusCode::CREATED,
        Json(CreateEntityMentionResponse {
            id: entity_mention.id.to_string(),
            source_entity_type: entity_mention.source_entity_type,
            source_entity_id: entity_mention.source_entity_id,
            entity_type: entity_mention.entity_type,
            entity_id: entity_mention.entity_id,
            user_id: entity_mention.user_id,
            created_at: entity_mention.created_at,
        }),
    )
        .into_response())
}
