use crate::api::context::ApiContext;
use axum::{Router, routing::post};

pub(in crate::api) mod backfill_docx;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/docx", post(backfill_docx::handler))
}
