use crate::api::context::ApiContext;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use model::response::ErrorResponse;
use serde_utils::urlencode::UrlEncoded;
use url::Url;
use utoipa::ToSchema;

#[cfg(test)]
mod tests;

#[derive(Clone, serde::Serialize, serde::Deserialize, ToSchema, Debug, Default)]
pub struct SsoState {
    #[schema(value_type = Option<String>)]
    pub original_url: Option<Url>,
    pub is_mobile: bool,
    pub referral_code: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct LoginQueryParams {
    idp_name: Option<String>,
    idp_id: Option<String>,
    login_hint: Option<String>,
    /// Once the frontend is update to NOT 2x urlencode this then this should be changed to
    /// `Option<Url>`
    original_url: Option<UrlEncoded<Url>>,
    #[serde(default)]
    is_mobile: bool,
    /// Optional referral code
    referral_code: Option<String>,
}

macro_env_var::maybe_env_vars! {
    /// The deployment's own app root, on an installation that is not Macro's.
    struct AppBaseUrl;
}

/// The host of `APP_BASE_URL`, when one is configured.
///
/// A self-hosted deployment serves the app from a domain this list cannot know
/// ahead of time, and SSO round-trips `original_url` through the identity
/// provider back to it. Without this, a configured Google or GitHub connector
/// cannot complete a login on any domain but Macro's own.
///
/// Deliberately narrow: the operator's single configured origin, not a wildcard
/// or a request-derived host. This function is the open-redirect guard for a
/// URL the client supplies, so it must never trust anything the client sends.
fn deployment_host() -> Option<String> {
    let base = AppBaseUrl::new()?;
    let url = Url::parse(base.as_ref()).ok()?;
    url.host_str().map(str::to_owned)
}

pub(crate) fn is_allowed_original_url(url: &Url) -> bool {
    match url.scheme() {
        // The app owns the custom scheme and handles all macro URI routes itself.
        "macro" => true,
        "tauri" => url.host_str() == Some("localhost"),
        "http" => matches!(url.host_str(), Some("localhost" | "tauri.localhost")),
        "https" => {
            matches!(
                url.host_str(),
                Some("localhost" | "tauri.localhost" | "dev.macro.com" | "macro.com")
            ) || matches!(
                (url.host_str(), deployment_host().as_deref()),
                (Some(host), Some(configured)) if host == configured
            )
        }
        _ => false,
    }
}

/// Strips the userinfo, query, and fragment from an `original_url` so it is
/// safe to log — all are client-controlled and may carry credentials, tokens,
/// or PII. The path is kept because it distinguishes e.g. macro://login from
/// macro:///login.
pub(crate) fn redact_original_url_for_logging(url: &Url) -> Url {
    let mut redacted_url = url.clone();
    redacted_url.set_query(None);
    redacted_url.set_fragment(None);
    // These only fail for cannot-be-a-base URLs, which carry no userinfo.
    let _ = redacted_url.set_username("");
    let _ = redacted_url.set_password(None);
    redacted_url
}

/// Initiates an SSO login
#[utoipa::path(
        get,
        path = "/login/sso",
        operation_id = "sso_login",
        params(
            ("idp_name" = String, Query, description = "The name of the identity provider to use for login. e.g Google"),
            ("idp_id" = String, Query, description = "**OPTIONAL**. The idp id of the identity provider to use for login."),
            ("login_hint" = String, Query, description = "**OPTIONAL**. The user's email."),
            ("original_url" = String, Query, description = "**OPTIONAL**. The original url you came from."),
            ("is_mobile" = String, Query, description = "**OPTIONAL**. If the authentication request is from a mobile device."),
            ("referral_code" = String, Query, description = "**OPTIONAL**. If the user opened a link with a referral code."),
        ),
        responses(
            (status = 200),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
// `query` is skipped: original_url is client-controlled (query/fragment may
// carry tokens) and login_hint is a user email — neither belongs in span fields.
#[tracing::instrument(skip(ctx, query), fields(idp_name = ?query.idp_name, idp_id = ?query.idp_id, is_mobile = query.is_mobile))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    query: Query<LoginQueryParams>,
) -> Result<Response, Response> {
    let Query(LoginQueryParams {
        idp_name,
        idp_id,
        login_hint,
        original_url,
        is_mobile,
        referral_code,
    }) = query;

    let original_url = original_url.map(|url| url.0);
    if let Some(url) = original_url
        .as_ref()
        .filter(|url| !is_allowed_original_url(url))
    {
        let redacted_url = redact_original_url_for_logging(url);
        tracing::error!(
            auth_handoff_failure = "original_url_rejected",
            original_url = %redacted_url,
            "original_url is not allowed"
        );
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "provided original_url is not allowed".into(),
            }),
        )
            .into_response());
    }

    if idp_name.is_none() && idp_id.is_none() {
        tracing::error!("idp_name and idp_id are both missing");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "idp_name or idp_id need to be provided".into(),
            }),
        )
            .into_response());
    }

    let idp_id = if let Some(idp_id) = idp_id {
        if idp_id.is_empty() {
            tracing::error!("idp_id is empty");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provided idp_id is empty".into(),
                }),
            )
                .into_response());
        }

        idp_id.clone()
    } else {
        let idp_name = idp_name.unwrap_or_default();

        if idp_name.is_empty() {
            tracing::error!("idp_name is empty");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provided idp_name is empty".into(),
                }),
            )
                .into_response());
        }

        let sso_idp_id = ctx
            .auth_client
            .get_identity_provider_id_by_name(&idp_name)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to find idp id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to find idp from idp_name".into(),
                    }),
                )
                    .into_response()
            })?;

        tracing::trace!(sso_idp_id, "idp found from name");

        sso_idp_id
    };

    let state = SsoState {
        is_mobile,
        original_url,
        referral_code,
    };

    // Only include state if it has a value
    let sso_state =
        (state.is_mobile || state.original_url.is_some() || state.referral_code.is_some())
            .then_some(state);

    // Generate code
    let sso_url = ctx
        .auth_client
        .construct_oauth2_authorize_url(&idp_id, login_hint.as_deref(), sso_state)
        .map_err(|e| {
            tracing::error!(error=?e, "unable to construct oauth2 authorize url");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "unable to serialize state into string".into(),
                }),
            )
                .into_response()
        })?;

    tracing::info!(sso_url=%sso_url, "SSO URL");

    Ok(Redirect::temporary(&sso_url).into_response())
}
