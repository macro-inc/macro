use axum::Router;
use axum::routing::get;

use crate::api::{
    context::SearchHandlerState,
    search::{self},
};

pub fn router() -> Router<SearchHandlerState> {
    Router::new()
        .nest("/search", search::router())
        .route("/health", get(async move || "healthy"))
}
