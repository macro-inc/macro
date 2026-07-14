pub(crate) mod cancel;
pub(crate) mod get;

use axum::Router;
use axum::routing::{delete, get};

use crate::api::ApiContext;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    // Link-scoped routes: each resolves and attaches the caller's email link.
    let link_scoped = Router::new()
        .route("/gmail", delete(cancel::handler))
        .route("/gmail/{id}", get(get::handler))
        .route("/gmail/active", get(get::active_handler))
        .layer(axum::middleware::from_fn_with_state(
            state.email_service,
            crate::api::middleware::link::attach_link_context,
        ));

    // GET /gmail is the user-scoped collection: it lists jobs across all of the
    // user's links via the fusionauth id in the request context, so it must not
    // go through the link middleware. Merged onto the same /gmail path as DELETE
    // (different method, so no conflict).
    link_scoped.merge(Router::new().route("/gmail", get(get::list_handler)))
}
