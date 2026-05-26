use ::unfurl::{
    domain::{ports::UnfurlFetcher, service::UnfurlServiceImpl},
    inbound::axum_router::{UnfurlRouterState, unfurl_router},
};
use axum::{Router, routing::post};

use crate::api::context::ApiContext;

pub mod get_unfurl;

/// Build the `/unfurl` subtree: hexified GET handler from the `unfurl` crate
/// plus the legacy `POST /bulk` handler living in this service.
pub fn router<F>(unfurl_state: UnfurlRouterState<UnfurlServiceImpl<F>>) -> Router<ApiContext>
where
    F: UnfurlFetcher,
    anyhow::Error: From<F::Err>,
{
    Router::new()
        .route("/bulk", post(get_unfurl::get_bulk_unfurl_handler))
        .merge(unfurl_router(unfurl_state))
}
