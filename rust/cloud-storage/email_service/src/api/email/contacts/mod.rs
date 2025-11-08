use crate::api::ApiContext;
use axum::Router;
use axum::routing::get;

pub(crate) mod list;

pub fn router() -> Router<ApiContext> {
    Router::new().route("/", get(list::list_contacts_handler))
}
