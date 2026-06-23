pub mod chat_history;
pub mod chat_history_batch_messages;

use super::context::ApiContext;
use axum::{
    Router,
    routing::{get, post},
};
use chat::domain::service::{ChatServiceImpl, ModelAccessServiceImpl};
use chat::inbound::http::models::models_router;
use chat::inbound::http::router::{ChatRouterState, chat_create_router, chat_id_router};
use chat::outbound::postgres::PgChatRepo;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let access_repo = PgAccessRepository::new(state.db.clone());
    let access_service = EntityAccessServiceImpl::new(access_repo);
    let chat_repo = PgChatRepo::new(state.db.clone());

    let chat_service = ChatServiceImpl::new(
        chat_repo,
        state.all_tools.clone(),
        state.tool_service_context.clone(),
        entity_access_management::domain::service::EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(state.db.clone()),
        ),
    );
    let chat_state = ChatRouterState::new(chat_service, access_service);

    let ensure_chat_exists = axum::middleware::from_fn_with_state(
        state.clone(),
        macro_middleware::cloud_storage::chat::ensure_chat_exists::handler,
    );

    Router::new()
        // Create route — needs ensure_user_exists, no ensure_chat_exists.
        // Note: free users are intentionally no longer capped by chat/document count,
        // so no quota-enforcement middleware is applied here.
        .merge(
            chat_create_router(chat_state.clone()).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    )),
            ),
        )
        // All /{chat_id} routes — need ensure_chat_exists for ChatAccessLevelExtractor
        .merge(
            chat_id_router(chat_state).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        // Per-user model access list — needs user + permissions populated.
        .merge(
            models_router(ModelAccessServiceImpl).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::attach_user_permissions::handler,
                    )),
            ),
        )
        // History routes — remain in DCS
        .route(
            "/history/{chat_id}",
            get(chat_history::get_chat_history_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists),
            ),
        )
        .route(
            "/history_batch_messages",
            post(chat_history_batch_messages::get_chat_history_batch_messages_handler).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                )),
            ),
        )
}
