pub(crate) mod access;
pub(crate) mod delete;
pub(crate) mod list;
pub(crate) mod resync;

use crate::api::ApiContext;
use axum::Router;
use axum::routing::{delete, get, post};

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(list::list_links_handler))
        .route("/{link_id}", delete(delete::delete_link_handler))
        .route("/{link_id}/resync", post(resync::resync_link_handler))
}
