use axum::{Router, routing::post};

use crate::api::context::SearchHandlerState;

pub(in crate::api) mod channel;
pub(in crate::api) mod chat;
pub(in crate::api) mod document;
pub(in crate::api) mod email;
pub(in crate::api::search) mod enrich;
pub(in crate::api) mod project;
pub mod simple;
pub mod unified;

pub fn router() -> Router<SearchHandlerState> {
    Router::new()
        .route("/", post(unified::handler))
        .nest("/simple", simple::router())
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct SearchPaginationParams {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
    pub cursor: Option<String>,
}
