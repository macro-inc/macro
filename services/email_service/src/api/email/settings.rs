use crate::api::context::ApiContext;
use crate::api::email::settings::import_signature::import_signature_handler;
use crate::api::email::settings::patch::patch_settings_handler;
use axum::Router;
use axum::routing::{get, patch, post};

pub(crate) mod import_signature;
pub(crate) mod operations;
pub(crate) mod patch;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", patch(patch_settings_handler))
        .route("/import-signature", post(import_signature_handler))
        .route("/operations", get(operations::handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::api::middleware::link::attach_link_context,
        ))
}
