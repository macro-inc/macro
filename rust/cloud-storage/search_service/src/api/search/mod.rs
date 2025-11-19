use axum::{Router, routing::post};

use crate::api::ApiContext;

pub(in crate::api) mod channel;
pub(in crate::api) mod chat;
pub(in crate::api) mod document;
pub(in crate::api) mod email;
pub(in crate::api::search) mod enrich;
pub(in crate::api) mod project;
pub(in crate::api) mod simple;
pub(in crate::api) mod unified;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", post(unified::handler))
        .route("/document", post(document::handler))
        .route("/chat", post(chat::handler))
        .route("/email", post(email::handler))
        .route("/channel", post(channel::handler))
        .route("/project", post(project::handler))
        .nest("/simple", simple::router())
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct SearchPaginationParams {
    pub page: Option<u32>,
    pub page_size: Option<u32>,
}
