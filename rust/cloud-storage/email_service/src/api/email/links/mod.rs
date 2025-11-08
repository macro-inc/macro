pub(crate) mod list;

use crate::api::ApiContext;
use axum::Router;
use axum::routing::get;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", get(list::list_links_handler))
}
