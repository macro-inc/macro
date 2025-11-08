use axum::{
    Router,
    routing::{delete, get, patch, post},
};
use tower::ServiceBuilder;

use crate::api::context::ApiContext;

use super::middleware;

pub(in crate::api) mod delete_user;
pub(in crate::api) mod get_invited_users;
pub(in crate::api) mod get_users;
pub(in crate::api) mod invite_user;
pub(in crate::api) mod patch_user_role;
pub(in crate::api) mod revoke_user_invite;

pub fn router() -> Router<ApiContext> {
    Router::new()
        .route("/", get(get_users::get_users_handler))
        .route(
            "/invited",
            get(get_invited_users::get_invited_users_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(middleware::ensure_it_permission::handler),
            )),
        )
        .route(
            "/role",
            patch(patch_user_role::patch_user_role_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(middleware::ensure_it_permission::handler),
            )),
        )
        .route(
            "/",
            delete(delete_user::delete_user_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(middleware::ensure_it_permission::handler),
            )),
        )
        .route(
            "/invite",
            post(invite_user::invite_user_handler).layer(ServiceBuilder::new().layer(
                axum::middleware::from_fn(middleware::ensure_it_permission::handler),
            )),
        )
        .route(
            "/invite",
            delete(revoke_user_invite::revoke_user_invite_handler).layer(
                ServiceBuilder::new().layer(axum::middleware::from_fn(
                    middleware::ensure_it_permission::handler,
                )),
            ),
        )
}
