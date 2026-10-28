use axum::Router;
use axum::routing::{delete, get, post};

use crate::api::ApiContext;

mod delete_user;
mod get_message_by_id;
mod get_message_senders;
mod get_messages_by_thread_id;
mod get_thread_histories;
mod get_thread_owner;
mod gmail;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/messages/{id}", get(get_message_by_id::handler))
        .route(
            "/messages/batch",
            post(get_message_by_id::get_message_by_id_batch_handler),
        )
        .route("/messages/senders", post(get_message_senders::handler))
        .route("/threads/histories", post(get_thread_histories::handler))
        .route(
            "/threads/{id}/messages",
            get(get_messages_by_thread_id::handler),
        )
        .route("/backfill/provider/gmail", post(gmail::create::handler))
        .route("/backfill/provider/gmail", delete(gmail::cancel::handler))
        .route("/backfill/provider/gmail/{id}", get(gmail::get::handler))
        .route("/delete_user/{id}", delete(delete_user::handler))
        .route("/threads/{id}/owner", get(get_thread_owner::handler))
}
