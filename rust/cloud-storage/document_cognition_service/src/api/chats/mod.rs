pub mod chat_history;
pub mod chat_history_batch_messages;
pub mod copy_chat;
pub mod create_user_chat;
pub mod delete_chat;
pub mod get_chat;
pub mod get_chat_permissions;
pub mod get_chats;
pub mod patch_chat;
pub mod revert_delete_chat;

use super::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};
use tower::ServiceBuilder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let ensure_chat_exists = axum::middleware::from_fn_with_state(
        state.clone(),
        macro_middleware::cloud_storage::chat::ensure_chat_exists::handler,
    );

    Router::new()
        .route(
            "/",
            post(create_user_chat::create_chat_handler).layer(
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
        .route(
            "/:chat_id/copy",
            post(copy_chat::copy_chat_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/",
            get(get_chats::get_chats_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route(
            "/:chat_id",
            get(get_chat::get_chat_handler)
                .layer(ServiceBuilder::new().layer(ensure_chat_exists.clone())),
        )
        .route(
            "/:chat_id/revert_delete",
            put(revert_delete_chat::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/:chat_id",
            delete(delete_chat::delete_chat_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/:chat_id/permanent",
            delete(delete_chat::permanently_delete_chat_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/:chat_id",
            patch(patch_chat::patch_chat_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/:chat_id/permissions",
            get(get_chat_permissions::get_chat_permissions_handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn(
                        macro_middleware::auth::ensure_user_exists::handler,
                    ))
                    .layer(ensure_chat_exists.clone()),
            ),
        )
        .route(
            "/history/:chat_id",
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
