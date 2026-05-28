use crate::config::BASE_URL;
use axum::{Router, extract::State, routing::get};
use tower_cookies::CookieManagerLayer;

mod github;
mod google;
mod login;

pub fn router() -> Router<ApiContext> {
    Router::new().route(
        "/{provider}/callback",
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

pub(in crate::api) fn format_redirect_uri(provider: &str) -> String {
    format!("{}/oauth2/{provider}/callback", *BASE_URL)
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub(in crate::api) struct OAuthState {
    /// The identity provider id to use to complete the login
    pub identity_provider_id: String,
    /// The link id to use to complete the login
    /// If the link id is provided, this means we need to link this idp to a specific user before
    /// performing the login process
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link_id: Option<uuid::Uuid>,
    /// The original url you came from
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_url: Option<String>,
    /// If the authentication request is from a mobile device
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_mobile: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
pub(in crate::api) struct Params {
    /// The code to complete the login
    code: Option<String>,
    /// State that is passed from the original request
    state: String,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    error_description: Option<String>,
    #[serde(default)]
    error_reason: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(in crate::api) struct PathParams {
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
                message: "unable to deserialize state".into(),
            }),
        )
            .into_response()
    })?;

    let code = match params.code {
        Some(c) => c,
        None => {
            tracing::warn!(
                error = ?params.error,
                error_reason = ?params.error_reason,
                error_description = ?params.error_description,
                "oauth2 callback received without code",
            );
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "Sign-in failed. Please try again or contact support.".into(),
                }),
            )
                .into_response());
        }
    };

    match provider.as_str() {
        "google" => google::handler(&ctx, cookies, &code, &state).await,
        "github" => github::handler(&ctx, cookies, &code, &state)
            .await
            .map(|r| r.into_response())
            .map_err(|e| e.into_response()),
        _ => Err((
            StatusCode::NOT_IMPLEMENTED,
            Json(ErrorResponse {
                message: "oauth2 callback not implemented for this provider".into(),
            }),
        )
            .into_response()),
    }
}
