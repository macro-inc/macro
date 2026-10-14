use crate::api::context::ApiContext;
use crate::api::email::settings::import_signature::import_signature_handler;
use crate::api::email::settings::patch::patch_settings_handler;
use crate::api::email::settings::send_as::list_send_as_handler;
use axum::Router;
use axum::routing::{get, patch, post};

pub(crate) mod import_signature;
pub(crate) mod patch;
pub(crate) mod send_as;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/", patch(patch_settings_handler))
        .route("/import-signature", post(import_signature_handler))
        .route("/send-as", get(list_send_as_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.clone(),
            crate::api::middleware::link::attach_link_context,
        ))
}
