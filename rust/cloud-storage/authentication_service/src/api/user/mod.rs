use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use tower::ServiceBuilder;
use tower_cookies::CookieManagerLayer;

use crate::api::ApiContext;

// needs to be public in api crate for swagger
pub(in crate::api) mod create_user;
pub(in crate::api) mod delete_user;
pub(in crate::api) mod get_legacy_user_permissions;
pub(in crate::api) mod get_name;
pub(in crate::api) mod get_user_info;
pub(in crate::api) mod get_user_link_exists;
pub(in crate::api) mod get_user_organization;
pub(in crate::api) mod get_user_quota;
pub(in crate::api) mod patch_ai_consent;
pub(in crate::api) mod patch_tutorial;
pub(in crate::api) mod patch_user_group;
pub(in crate::api) mod patch_user_onboarding;
pub(in crate::api) mod post_get_names;
pub(in crate::api) mod post_get_names_with_email;
pub(in crate::api) mod post_profile_pictures;
pub(in crate::api) mod put_name;
pub(in crate::api) mod put_profile_picture;
pub(in crate::api) mod stripe;

pub fn router(state: ApiContext, jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/", post(create_user::handler))
        .layer(ServiceBuilder::new().layer(axum::middleware::from_fn(
            macro_middleware::tracking::attach_ip_context_handler, // attach ip context to all requests
        )))
        .merge(router_with_auth(state, jwt_args))
}

fn router_with_auth(state: ApiContext, jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/me", get(get_user_info::handler))
        .route("/me", delete(delete_user::handler))
        .route("/profile_pictures", post(post_profile_pictures::handler))
        .route("/profile_picture", put(put_profile_picture::handler))
        .route("/name", put(put_name::handler))
        .route("/name", get(get_name::handler))
        .route("/get_names", post(post_get_names::handler_external))
        .route(
            "/get_names_with_email",
            post(post_get_names_with_email::handler),
        )
        .route("/link_exists", get(get_user_link_exists::handler))
        .route("/tutorial", patch(patch_tutorial::handler))
        .route("/ai_consent", patch(patch_ai_consent::handler))
        .route(
            "/quota",
            get(get_user_quota::handler).layer(axum::middleware::from_fn_with_state(
                state.clone(),
                macro_middleware::user_permissions::attach_user_permissions::handler,
            )),
        )
        .route("/stripe/checkout", post(stripe::create_checkout_session))
        .route("/stripe/portal", post(stripe::create_portal_session))
        .route(
            "/legacy_user_permissions",
            get(get_legacy_user_permissions::handler),
        )
        .route("/organization", get(get_user_organization::handler))
        .route("/group", patch(patch_user_group::handler))
        .route("/onboarding", patch(patch_user_onboarding::handler))
        .layer(
            ServiceBuilder::new()
                .layer(CookieManagerLayer::new())
                .layer(axum::middleware::from_fn_with_state(
                    jwt_args,
                    macro_middleware::auth::decode_jwt::handler,
                )),
        )
}
