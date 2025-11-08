use axum::Router;
use axum::routing::get;

use crate::api::{
    ApiContext,
    search::{self},
};

pub fn router() -> Router<ApiContext> {
    Router::new()
        .nest("/search", search::router())
        .route("/health", get(async move || "healthy"))
}
