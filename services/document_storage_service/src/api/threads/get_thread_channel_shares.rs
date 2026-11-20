use crate::{
    api::context::{ApiContext, AuthorizationService, EntityAccessService},
    service::entity_mutation::ThreadChannelShare,
};
use axum::{Json, extract::State, http::StatusCode};
use entity_access::inbound::axum_extractors::ThreadAccessLevelExtractor;
use entity_mutation::EntityMutationErrorCode;
use models_permissions::share_permission::access_level::OwnerAccessLevel;

/// List a thread owner's grants to channels they participate in.
#[utoipa::path(
    get,
    tag = "threads",
    operation_id = "get_thread_channel_shares",
    path = "/threads/{thread_id}/channel-shares",
    params(("thread_id" = String, Path, description = "Thread ID")),
    responses(
        (status = 200, body = Vec<ThreadChannelShare>),
        (status = 400, description = "Invalid thread ID"),
        (status = 401, description = "Owner access required"),
        (status = 403, description = "User session required"),
        (status = 500, description = "Unable to read thread shares"),
    )
)]
pub async fn handler(
    access: ThreadAccessLevelExtractor<OwnerAccessLevel, EntityAccessService, AuthorizationService>,
    State(ctx): State<ApiContext>,
) -> Result<Json<Vec<ThreadChannelShare>>, StatusCode> {
    ctx.graphql_entity_mutation_service
        .thread_channel_shares(access.entity_access_receipt)
        .await
        .map(Json)
        .map_err(|error| match error {
            EntityMutationErrorCode::InvalidInput(_) => StatusCode::BAD_REQUEST,
            EntityMutationErrorCode::Forbidden(_) => StatusCode::FORBIDDEN,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        })
}
