use crate::api::context::ApiContext;
use axum::{Router, routing::post};
use tower::ServiceBuilder;

pub(in crate::api) mod create_permission_token;
pub(in crate::api) mod validate_permissions_token;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route("/validate", post(validate_permissions_token::handler))
        .route(
            "/:document_id",
            post(create_permission_token::handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn_with_state(
                    state.clone(),
                    macro_middleware::cloud_storage::document::ensure_document_exists::handler,
                ),
            )),
        )
}
