use crate::{
    account_link_state::{
        AccountLinkState, AccountLinkStateError, AccountLinkStateKey, LinkProvider,
        verify_account_link_state,
    },
    api::login::sso::{is_allowed_original_url, redact_original_url_for_logging},
    config::BASE_URL,
};
use axum::{Router, extract::State, routing::get};
use tower_cookies::CookieManagerLayer;
use url::Url;

mod account_link;
mod github;
mod google;
mod login;
mod microsoft;

#[cfg(test)]
mod test;

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

/// The state the provider handlers complete a callback with.
///
/// Account-link flows never arrive in this shape. Their `state` is a signed
/// [`AccountLinkState`] token that [`parse_callback_state`] verifies before
/// converting it into this struct. Plain JSON is accepted only for sign-in,
/// which carries no `link_id`.
#[derive(Debug, serde::Deserialize)]
pub(in crate::api) struct OAuthState {
    /// The identity provider id to use to complete the login
    pub identity_provider_id: String,
    /// The pending account link to complete instead of signing in. Populated
    /// only from a verified [`AccountLinkState`]; unsigned state that names a
    /// link is rejected.
    #[serde(default)]
    pub link_id: Option<uuid::Uuid>,
    /// The original url you came from
    #[serde(default)]
    pub original_url: Option<String>,
    /// If the authentication request is from a mobile device
    #[serde(default)]
    pub is_mobile: Option<bool>,
}

impl From<&AccountLinkState> for OAuthState {
    fn from(state: &AccountLinkState) -> Self {
        Self {
            identity_provider_id: state.identity_provider_id.clone(),
            link_id: Some(state.link_id),
            original_url: state.original_url.clone(),
            is_mobile: None,
        }
    }
}

/// What a callback's `state` parameter verified as.
#[derive(Debug)]
enum CallbackState {
    /// A signed token issued by one of the `/link/*` handlers.
    AccountLink(AccountLinkState),
    /// Unsigned sign-in state. Never carries a `link_id`.
    Login(OAuthState),
}

impl CallbackState {
    fn original_url(&self) -> Option<&str> {
        match self {
            Self::AccountLink(state) => state.original_url.as_deref(),
            Self::Login(state) => state.original_url.as_deref(),
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
enum CallbackStateError {
    /// A signed token that failed verification.
    Signed(AccountLinkStateError),
    /// Unsigned state that is not valid sign-in state.
    Unparseable,
    /// Unsigned state naming a pending link. Only a signed token may do that.
    UnsignedAccountLink,
    /// A verified token presented to a different provider's callback.
    ProviderMismatch {
        /// The callback the token was issued for.
        issued_for: LinkProvider,
    },
}

/// Verifies the raw `state` for the `provider` callback that received it.
///
/// Signed tokens never start with `{`, so a leading brace selects the legacy
/// sign-in JSON. That path refuses any `link_id`: the pending links it would
/// name are reachable only through a token this service signed, bound to the
/// user who created them and to the provider that will call back.
fn parse_callback_state(
    raw: &str,
    provider: &str,
    key: &AccountLinkStateKey,
    current_timestamp: i64,
) -> Result<CallbackState, CallbackStateError> {
    if raw.trim_start().starts_with('{') {
        let state: OAuthState =
            serde_json::from_str(raw).map_err(|_| CallbackStateError::Unparseable)?;
        if state.link_id.is_some() {
            return Err(CallbackStateError::UnsignedAccountLink);
        }
        return Ok(CallbackState::Login(state));
    }

    let state = verify_account_link_state(raw, key, current_timestamp)
        .map_err(CallbackStateError::Signed)?;
    if state.provider.as_str() != provider {
        return Err(CallbackStateError::ProviderMismatch {
            issued_for: state.provider,
        });
    }

    Ok(CallbackState::AccountLink(state))
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

#[derive(Debug)]
enum OriginalUrlValidationError {
    Invalid,
    Disallowed(Url),
}

fn validate_original_url(original_url: Option<&str>) -> Result<(), OriginalUrlValidationError> {
    let Some(original_url) = original_url else {
        return Ok(());
    };

    // Sign-in state is client-visible and may be forged, and a signed link state
    // still carries whatever URL the caller asked for. Decode it exactly as the
    // redirect handlers do before validating the resulting destination.
    let decoded_url =
        urlencoding::decode(original_url).map_err(|_| OriginalUrlValidationError::Invalid)?;
    let url = Url::parse(&decoded_url).map_err(|_| OriginalUrlValidationError::Invalid)?;

    if !is_allowed_original_url(&url) {
        return Err(OriginalUrlValidationError::Disallowed(url));
    }

    Ok(())
}

fn error_response(status: StatusCode, message: &'static str) -> Response {
    (
        status,
        Json(ErrorResponse {
            message: message.into(),
        }),
    )
        .into_response()
}

/// The pending row must still belong to the user named in the signed state.
/// Completing a link against anyone else's row would attach this consent to
/// their account.
async fn verify_pending_link_owner(
    ctx: &ApiContext,
    state: &AccountLinkState,
) -> Result<(), Response> {
    let owner = macro_db_client::in_progress_user_link::get_macro_user_id_by_link_id(
        &ctx.db,
        &state.link_id,
    )
    .await
    .map_err(|error| {
        if matches!(
            error.downcast_ref::<sqlx::Error>(),
            Some(sqlx::Error::RowNotFound)
        ) {
            tracing::warn!(link_id = %state.link_id, "pending account link not found");
            error_response(StatusCode::NOT_FOUND, "pending account link not found")
        } else {
            tracing::error!(error=?error, "unable to load pending account link");
            error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to load pending account link",
            )
        }
    })?;

    if owner != state.fusion_user_id {
        tracing::error!(
            link_id = %state.link_id,
            "account-link state and pending link name different users"
        );
        return Err(error_response(
            StatusCode::FORBIDDEN,
            "pending account link belongs to another user",
        ));
    }

    Ok(())
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

    let state = match parse_callback_state(
        &params.state,
        &provider,
        &ctx.account_link_state_key,
        chrono::Utc::now().timestamp(),
    ) {
        Ok(state) => state,
        Err(CallbackStateError::Signed(AccountLinkStateError::Expired { link_id })) => {
            // The token is authentic, so the pending row it names is safe to
            // release instead of counting toward the user's in-progress cap
            // for the rest of the day.
            tracing::warn!(%link_id, "account-link state expired before the provider called back");
            account_link::cleanup_pending_link(&ctx, &link_id).await;
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "account link request expired; start it again",
            ));
        }
        Err(error) => {
            tracing::error!(error=?error, "rejected oauth2 callback state");
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "unable to verify state",
            ));
        }
    };

    // Provider errors arrive without a code. Release the pending link before
    // validating the redirect so an invalid original_url cannot leave it
    // behind. The state is verified, so the row it names is the caller's own.
    if params.code.is_none()
        && let CallbackState::AccountLink(link_state) = &state
    {
        account_link::cleanup_pending_link(&ctx, &link_state.link_id).await;
    }

    validate_original_url(state.original_url()).map_err(|error| {
        match error {
            OriginalUrlValidationError::Invalid => {
                tracing::error!(
                    auth_handoff_failure = "original_url_invalid",
                    "original_url in oauth2 state is invalid"
                );
            }
            OriginalUrlValidationError::Disallowed(url) => {
                let redacted_url = redact_original_url_for_logging(&url);
                tracing::error!(
                    auth_handoff_failure = "original_url_rejected",
                    original_url = %redacted_url,
                    "original_url in oauth2 state is not allowed"
                );
            }
        }

        error_response(
            StatusCode::BAD_REQUEST,
            "provided original_url is not allowed",
        )
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
            return Err(error_response(
                StatusCode::BAD_REQUEST,
                "Sign-in failed. Please try again or contact support.",
            ));
        }
    };

    let state = match state {
        CallbackState::Login(state) => state,
        CallbackState::AccountLink(link_state) => {
            verify_pending_link_owner(&ctx, &link_state).await?;
            OAuthState::from(&link_state)
        }
    };

    match provider.as_str() {
        "google" => google::handler(&ctx, cookies, &code, &state).await,
        "github" => github::handler(&ctx, cookies, &code, &state)
            .await
            .map(|r| r.into_response())
            .map_err(|e| e.into_response()),
        "microsoft" => microsoft::handler(&ctx, &code, &state).await,
        _ => Err(error_response(
            StatusCode::NOT_IMPLEMENTED,
            "oauth2 callback not implemented for this provider",
        )),
    }
}
