use super::context::ApiContext;
use crate::api::utils::{create_access_token_cookie, create_refresh_token_cookie};
use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use decode_jwt::DecodedJwt;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
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
#[tracing::instrument(
    skip(ctx, decoded_jwt, cookies),
    fields(
        user_id=%decoded_jwt.user_context.user_id,
        organization_id=?decoded_jwt.user_context.organization_id,
        audience=%decoded_jwt.jwt_context.as_ref().map(|context| context.audience.as_str()).unwrap_or_default(),
        tid=%decoded_jwt.jwt_context.as_ref().map(|context| context.tid.as_str()).unwrap_or_default(),
    )
)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    decoded_jwt: DecodedJwt,
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

    // Tokens without JWT context do not identify a FusionAuth session.
    if let Some(jwt_context) = decoded_jwt.jwt_context {
        let _ = ctx
            .auth_client
            .logout(&jwt_context.tid)
            .await
            .inspect_err(|e| tracing::warn!(error=?e, "error logging out"));
    }

    Ok((StatusCode::OK, Json(EmptyResponse::default())).into_response())
}
