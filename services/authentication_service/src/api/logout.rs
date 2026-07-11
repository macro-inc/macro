use super::context::ApiContext;
use crate::api::utils::{create_access_token_cookie, create_refresh_token_cookie};
use axum::{
    Extension, Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_middleware::auth::decode_jwt::JwtContext;
use model::response::EmptyResponse;
use model::user::UserContext;
use tower::ServiceBuilder;
use tower_cookies::{CookieManagerLayer, Cookies};

pub fn router(jwt_args: JwtValidationArgs) -> Router<ApiContext> {
    Router::new()
        .route("/", post(handler))
        .route("/", get(handler))
        .layer(
            ServiceBuilder::new()
                .layer(CookieManagerLayer::new())
                .layer(axum::middleware::from_fn_with_state(
                    jwt_args,
                    macro_middleware::auth::decode_jwt::handler,
                )),
        )
}

/// Initiates a passwordless login
#[utoipa::path(
        post,
        operation_id = "logout",
        path = "/logout",
        responses(
            (status = 200, body= EmptyResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, jwt_context, cookies), fields(user_id=%user_context.user_id, organization_id=?user_context.organization_id, audience=%jwt_context.audience, tid=%jwt_context.tid))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    jwt_context: Extension<JwtContext>,
    cookies: Cookies,
) -> Result<Response, Response> {
    // Remove access token cookie
    let mut access_token_cookie = create_access_token_cookie("");
    access_token_cookie.set_expires(Some(time::OffsetDateTime::now_utc()));
    cookies.add(access_token_cookie);

    // Remove refresh token cookie
    let mut refresh_token_cookie = create_refresh_token_cookie("");
    refresh_token_cookie.set_expires(Some(time::OffsetDateTime::now_utc()));
    cookies.add(refresh_token_cookie);

    // Logout of fusionauth
    if let Err(e) = ctx.auth_client.logout(&jwt_context.tid).await {
        tracing::warn!(error=%e, "error logging out");
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
