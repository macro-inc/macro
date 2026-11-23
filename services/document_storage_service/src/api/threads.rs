pub(in crate::api) mod edit_thread;
pub(in crate::api) mod get_thread_access_level;
pub(in crate::api) mod get_thread_channel_shares;

use crate::api::context::ApiContext;
use axum::Router;
use axum::routing::{get, patch};

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/{thread_id}",
            patch(edit_thread::edit_thread_handler).layer(axum::middleware::from_fn_with_state(
                state,
                macro_middleware::cloud_storage::thread::ensure_thread_exists::handler,
            )),
        )
        .route(
            "/{thread_id}/channel-shares",
            get(get_thread_channel_shares::handler),
        )
}
