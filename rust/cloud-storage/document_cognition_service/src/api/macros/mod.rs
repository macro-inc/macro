pub mod create_macro;
pub mod delete_macro;
pub mod get_macro;
pub mod get_macro_permissions;
pub mod get_macros;
pub mod patch_macro;

use crate::api::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use tower::ServiceBuilder;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route(
            "/",
            post(create_macro::create_macro_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route(
            "/",
            get(get_macros::get_macros_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route("/:macro_prompt_id", get(get_macro::get_macro_handler))
        .route(
            "/:macro_prompt_id/permissions",
            get(get_macro_permissions::get_macro_permissions_handler).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    macro_middleware::auth::ensure_user_exists::handler,
                )),
            ),
        )
        .route(
            "/:macro_prompt_id",
            patch(patch_macro::patch_macro_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
        .route(
            "/:macro_prompt_id",
            delete(delete_macro::delete_macro_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(macro_middleware::auth::ensure_user_exists::handler),
            )),
        )
}
