use axum::{Router, routing::get};

use crate::api::context::AppState;
pub mod references;

pub fn router() -> Router<AppState> {
    Router::new().route(
        "/:entity_type/:entity_id/references",
        get(references::handler),
    )
}
