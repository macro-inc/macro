use crate::{
    constants::DEFAULT_TIMEOUT_THRESHOLD,
    context::{ApiContext, AppState},
};
use anyhow::Result;
use axum::{
    Json as JsonResponse, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    response::ErrorResponse,
    routing::get,
};
use macro_middleware::auth;
use model_entity::Entity;
use utoipa::ToSchema;

pub fn router<S>(state: AppState) -> Router<S>
where
    S: Send + Sync + Clone + 'static,
{
    Router::new()
        .route("/:entity_type/:entity_id", get(get_entity_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            auth::internal_access::handler,
        ))
        .with_state(state)
}

#[derive(serde::Deserialize, Debug, ToSchema)]
pub struct QueryParams {
    /// the threshold in seconds to consider a user active
    pub timeout_threshold: Option<u64>,
}

#[utoipa::path(
        get,
        path = "/track/{entity_type}/{entity_id}",
        params(
            ("entity_type" = String, Path, description = "the type of the entity to send the msssage to e.g. \"user\" | \"channel\" | \"document\" etc..."),
            ("entity_id" = String, Path, description = "the id of the entity to send the message to"),
        ),
        responses(
            (status = 200, body=Vec<String>),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx))]
#[axum::debug_handler(state = AppState)]
pub async fn get_entity_handler(
    State(ctx): State<ApiContext>,
    Path(entity): Path<Entity<'static>>,
    Query(query_params): Query<QueryParams>,
) -> Result<JsonResponse<Vec<String>>, ErrorResponse> {
    let entities = ctx
        .connection_manager
        .get_entries_by_entity(&entity)
        .await
        .map_err(|_| {
            ErrorResponse::from((
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get entries by entity",
            ))
        })?;

    let timeout_threshold = query_params
        .timeout_threshold
        .unwrap_or(DEFAULT_TIMEOUT_THRESHOLD);

    let users: Vec<String> = entities
        .into_iter()
        .filter_map(|c| {
            if c.is_active_in_threshold(Some(timeout_threshold)) {
                Some(c.user_id)
            } else {
                None
            }
        })
        .collect();

    Ok(JsonResponse(users))
}
