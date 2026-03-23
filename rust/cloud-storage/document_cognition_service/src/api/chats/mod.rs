pub mod chat_history;
pub mod chat_history_batch_messages;
pub mod tool;

use super::context::ApiContext;
use axum::{
    Router,
    routing::{get, post},
};
use chat::domain::service::ChatServiceImpl;
use chat::inbound::{ChatRouterState, chat_create_router, chat_id_router};
use chat::outbound::postgres::PgChatRepo;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let access_repo = PgAccessRepository::new(state.db.clone());
    let access_service = EntityAccessServiceImpl::new(access_repo);
    let chat_repo = PgChatRepo::new(state.db.clone());
    let chat_service = ChatServiceImpl::new(chat_repo);
    let chat_state = ChatRouterState::new(chat_service, access_service);

    let ensure_chat_exists = axum::middleware::from_fn_with_state(
        state.clone(),
        macro_middleware::cloud_storage::chat::ensure_chat_exists::handler,
    );

    Router::new()
        // Create route — needs ensure_user_exists + quota middleware, no ensure_chat_exists
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
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        macro_middleware::user_permissions::validate_user_quota::ai_chat_message_handler,
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
        .nest(
            "/{chat_id}/tool",
            tool::router().layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
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
