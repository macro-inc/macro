use super::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, post},
};

pub(in crate::api) mod delete_history;
pub(in crate::api) mod get_history;
pub(in crate::api) mod upsert_history;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_history::get_history_handler))
        .route(
            "/:item_type/:item_id",
            post(upsert_history::upsert_history_handler),
        )
        .route(
            "/:item_type/:item_id",
            delete(delete_history::delete_history_handler),
        )
        .layer(axum::middleware::from_fn(
            macro_middleware::auth::ensure_user_exists::handler,
        ))
}
