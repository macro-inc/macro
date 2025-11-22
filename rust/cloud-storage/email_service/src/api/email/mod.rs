use axum::Router;
use axum::routing::post;

use crate::api::ApiContext;

pub(crate) mod attachments;
pub(crate) mod backfill;
pub(crate) mod contacts;
pub(crate) mod drafts;
pub(crate) mod init;
pub(crate) mod labels;
pub(crate) mod links;
pub(crate) mod messages;
pub(crate) mod settings;
pub(crate) mod sync;
pub(crate) mod threads;
pub(crate) mod validation;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new()
        .nest("/attachments", attachments::router(state.clone()))
        .nest("/labels", labels::router(state.clone()))
        .nest("/threads", threads::router(state.clone()))
        .nest("/drafts", drafts::router(state.clone()))
        .nest("/messages", messages::router(state.clone()))
        .nest("/links", links::router())
        .nest("/contacts", contacts::router())
        .nest("/backfill", backfill::router(state.clone()))
        .nest("/settings", settings::router(state.clone()))
        .nest("/sync", sync::router(state.clone()))
        // deleting all user info from the db can take a long time - prevent connection from dropping
        .layer(axum::middleware::from_fn(
            macro_middleware::connection_drop_prevention_handler,
        ))
        .route(
            "/init",
            post(init::handler).layer(axum::middleware::from_fn_with_state(
                state,
                crate::api::middleware::gmail_token::attach_gmail_token,
            )),
        )
}
