use axum::{
    Router,
    extract::FromRef,
    routing::{delete, get, post},
};
use macro_authorization::MacroAuthorizationState;
use sqlx::PgPool;

use crate::api::ApiContext;
use crate::api::context::AuthorizationService;

use super::user::post_get_names;

// needs to be public in api crate for swagger
mod delete_inbox_grant_user;
mod github_access_token;
mod google_access_token;
mod microsoft_access_token;
mod microsoft_grant;
mod post_get_existing_users;
mod relocate_inbox_grant;
mod remove_link;
mod revoke_microsoft_grant;
mod stripe_inbox_replay;

#[cfg(test)]
mod fusionauth_fixture;
#[cfg(test)]
mod test;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/github_access_token", get(github_access_token::handler))
        .route("/google_access_token", get(google_access_token::handler))
        .route("/microsoft_grant", get(microsoft_grant::handler))
        .route(
            "/microsoft_access_token",
            get(microsoft_access_token::handler),
        )
        .route(
            "/microsoft_disconnect_token",
            get(microsoft_access_token::disconnect_handler),
        )
        .route("/get_names", post(post_get_names::handler_internal))
        .merge(existing_users())
        .route("/remove_link", delete(remove_link::handler))
        .route(
            "/revoke_microsoft_grant",
            post(revoke_microsoft_grant::handler),
        )
        .route("/relocate_inbox_grant", post(relocate_inbox_grant::handler))
        .route(
            "/delete_inbox_grant_user",
            delete(delete_inbox_grant_user::handler),
        )
        .route("/stripe_inbox/replay", post(stripe_inbox_replay::handler))
        .route(
            "/stripe_inbox/replay_dead",
            post(stripe_inbox_replay::replay_dead_handler),
        )
}

/// `POST /get_existing_users`: which of a list of user ids name accounts. It
/// takes only the database and the authorization state, so a test serves it
/// without the whole API context.
fn existing_users<S>() -> Router<S>
where
    S: Clone + Send + Sync + 'static,
    PgPool: FromRef<S>,
    MacroAuthorizationState<AuthorizationService>: FromRef<S>,
{
    Router::new().route(
        "/get_existing_users",
        post(post_get_existing_users::handler),
    )
}
