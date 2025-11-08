use crate::api::context::ApiContext;
use axum::{Router, routing::get};
pub(in crate::api) mod recently_deleted;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/deleted", get(recently_deleted::handler))
}
