use axum::{
    Router,
    routing::{delete, get, post},
};

use crate::api::ApiContext;

use super::user::post_get_names;

// needs to be public in api crate for swagger
mod delete_inbox_grant_user;
mod google_access_token;
mod post_get_existing_users;
mod relocate_inbox_grant;
mod remove_link;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/google_access_token", get(google_access_token::handler))
        .route("/get_names", post(post_get_names::handler_internal))
        .route("/get_existing_users", get(post_get_existing_users::handler))
        .route("/remove_link", delete(remove_link::handler))
        .route("/relocate_inbox_grant", post(relocate_inbox_grant::handler))
        .route(
            "/delete_inbox_grant_user",
            delete(delete_inbox_grant_user::handler),
        )
}
