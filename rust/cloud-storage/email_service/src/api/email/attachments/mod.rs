use axum::Router;
use axum::routing::get;
use tower::ServiceBuilder;

use crate::api::ApiContext;

pub(crate) mod get;
pub(crate) mod get_document_id;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .route(
            "/:id",
            get(get::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::api::middleware::link::attach_link_context,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::api::middleware::gmail_token::attach_gmail_token,
                    )),
            ),
        )
        .route(
            "/:id/document_id",
            get(get_document_id::handler).layer(
                ServiceBuilder::new()
                    .layer(axum::middleware::from_fn_with_state(
                        state.clone(),
                        crate::api::middleware::link::attach_link_context,
                    ))
                    .layer(axum::middleware::from_fn_with_state(
                        state,
                        crate::api::middleware::gmail_token::attach_gmail_token,
                    )),
            ),
        )
}
