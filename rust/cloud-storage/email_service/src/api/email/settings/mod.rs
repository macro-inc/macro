use crate::api::context::ApiContext;
use crate::api::email::settings::patch::patch_settings_handler;
use axum::Router;
use axum::routing::patch;

pub(crate) mod patch;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", patch(patch_settings_handler))
        .layer(axum::middleware::from_fn_with_state(
            state,
            crate::api::middleware::link::attach_link_context,
        ))
}
