use super::{
    context::{ApiContext, AuthorizationService},
    jwt_session::JwtSessionContext,
};
use crate::api::utils::{create_access_token_cookie, create_refresh_token_cookie};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_authorization::MacroAuthorizationExtractor;
use model::response::EmptyResponse;
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
#[tracing::instrument(skip(ctx, authorization, jwt_session, cookies), fields(user_id=%authorization.user_context.user_id, organization_id=?authorization.user_context.organization_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService>,
    JwtSessionContext(jwt_session): JwtSessionContext,
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

    // Logout of fusionauth when the request used a FusionAuth session.
    if let Some(jwt_context) = jwt_session {
        if let Err(e) = ctx.auth_client.logout(&jwt_context.tid).await {
            tracing::warn!(error=?e, "error logging out");
        }
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
