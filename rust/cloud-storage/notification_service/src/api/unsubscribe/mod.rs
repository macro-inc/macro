use axum::{
    Router,
    routing::{delete, get, post},
};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

pub(in crate::api) mod get_unsubscribes;
pub(in crate::api) mod remove_unsubscribe_all;
pub(in crate::api) mod remove_unsubscribe_item;
pub(in crate::api) mod unsubscribe_all;
pub(in crate::api) mod unsubscribe_email;
pub(in crate::api) mod unsubscribe_item;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/email", get(unsubscribe_email::handler))
        .route("/", get(get_unsubscribes::handler))
        .route("/item/:item_type/:item_id", post(unsubscribe_item::handler))
        .route(
            "/item/:item_type/:item_id",
            delete(remove_unsubscribe_item::handler),
        )
        .route(
            "/mute",
            post(unsubscribe_all::handler).layer(ServiceBuilder::new()),
        )
        .route("/mute", delete(remove_unsubscribe_all::handler))
}
