use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{get, patch},
};
pub(in crate::api) mod get_settings;
pub(in crate::api) mod patch_organization_settings;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/settings", get(get_settings::get_settings_handler))
        .route(
            "/settings",
            patch(patch_organization_settings::patch_organization_settings_handler),
        )
}
