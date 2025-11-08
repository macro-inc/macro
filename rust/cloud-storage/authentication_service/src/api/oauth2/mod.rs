use crate::config::BASE_URL;
use axum::{Router, extract::State, routing::get};
use tower_cookies::CookieManagerLayer;

mod google;
mod login;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/:provider/callback",
        get(handler).layer(CookieManagerLayer::new()),
    )
}

use crate::api::context::ApiContext;
use axum::{
    Json, extract,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use model::response::ErrorResponse;
use tower_cookies::Cookies;

pub(in crate::api::oauth2) fn format_redirect_uri(provider: &str) -> String {
    format!("{}/oauth2/{provider}/callback", *BASE_URL)
}

#[derive(Debug, serde::Deserialize)]
pub(in crate::api::oauth2) struct OAuthState {
    /// The identity provider id to use to complete the login
    identity_provider_id: String,
    /// The link id to use to complete the login
    /// If the link id is provided, this means we need to link this idp to a specific user before
    /// performing the login process
    link_id: Option<String>,
    /// The original url you came from
    pub original_url: Option<String>,
    /// If the authentication request is from a mobile device
    pub is_mobile: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub(in crate::api::oauth2) struct Params {
    /// The code to complete the login
    code: String,
    /// State that is passed from the original request
    state: String,
}

#[derive(Debug, serde::Deserialize)]
struct PathParams {
    provider: String,
}

/// Custom OAuth2 callback
#[utoipa::path(
        get,
        path = "/oauth2/{provider}/callback",
        params(
            ("provider" = String, Path, description = "The provider to use"),
        ),
        operation_id = "oauth2_callback",
        responses(
            (status = 200),
            (status = 307),
            (status = 304, body=ErrorResponse),
            (status = 400, body=ErrorResponse),
            (status = 401, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, cookies, params))]
pub(in crate::api) async fn handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    extract::Path(PathParams { provider }): extract::Path<PathParams>,
    extract::Query(params): extract::Query<Params>,
) -> Result<Response, Response> {
    tracing::info!("oauth2_callback");

    let state: OAuthState = serde_json::from_str(&params.state).map_err(|e| {
        tracing::error!(error=?e, "unable to deserialize state");
        (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "unable to deserialize state",
            }),
        )
            .into_response()
    })?;

    match provider.as_str() {
        "google" => google::handler(&ctx, cookies, &params.code, &state).await,
        _ => Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(ErrorResponse {
                message: "oauth2 callback not implemented for this provider",
            }),
        )
            .into_response()),
    }
}
