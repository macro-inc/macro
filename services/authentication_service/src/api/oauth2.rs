use crate::{
    account_link_state::{
        AccountLinkState, AccountLinkStateError, AccountLinkStateKey, AdminConsentState,
        LinkProvider, SignedState, verify_signed_state,
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
    /// A signed token issued with a tenant-wide admin-consent URL.
    AdminConsent(AdminConsentState),
    /// Unsigned sign-in state. Never carries a `link_id`.
    Login(OAuthState),
}

impl CallbackState {
    fn original_url(&self) -> Option<&str> {
        match self {
            Self::AccountLink(state) => state.original_url.as_deref(),
            Self::AdminConsent(state) => Some(&state.original_url),
            Self::Login(state) => state.original_url.as_deref(),
        }
    }
}

/// Why a consent screen came back without an authorization code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConsentFailure {
    /// The directory lets only an administrator consent to Macro's permissions.
    AdminConsentRequired,
    /// The person on the consent screen declined or closed it.
    Cancelled,
    /// Anything else the provider reported.
    Failed,
}

impl ConsentFailure {
    /// Classifies the provider's `error` and `error_description`.
    ///
    /// Entra reports "Need admin approval" as `access_denied` with
    /// `AADSTS65001` in the description (`AADSTS90094` for the admin-consent
    /// endpoint itself); some tenants answer `consent_required` or
    /// `interaction_required` instead.
    fn classify(error: Option<&str>, error_description: Option<&str>) -> Self {
        let code = error_description.and_then(aadsts_code);
        if matches!(code, Some("AADSTS65001" | "AADSTS90094"))
            || matches!(error, Some("consent_required" | "interaction_required"))
        {
            return Self::AdminConsentRequired;
        }
        if error == Some("access_denied") {
            return Self::Cancelled;
        }
        Self::Failed
    }

    /// The `email_link_error` query value the app reads.
    fn as_str(self) -> &'static str {
        match self {
            Self::AdminConsentRequired => "admin_consent_required",
            Self::Cancelled => "cancelled",
            Self::Failed => "failed",
        }
    }
}

/// The `AADSTS` error code at the start of an Entra `error_description`, such
/// as `AADSTS65001`. Only the code is kept: the rest of the description names
/// the user, the app, and the tenant.
fn aadsts_code(error_description: &str) -> Option<&str> {
    let start = error_description.find("AADSTS")?;
    let code = &error_description[start..];
    let end = code["AADSTS".len()..]
        .find(|character: char| !character.is_ascii_digit())
        .map_or(code.len(), |digits| "AADSTS".len() + digits);
    Some(&code[..end]).filter(|code| code.len() > "AADSTS".len())
}

/// The `provider` query value the app reads, named for the inbox provider.
fn provider_query_value(provider: LinkProvider) -> &'static str {
    match provider {
        LinkProvider::Google => "gmail",
        LinkProvider::Github => "github",
        LinkProvider::Microsoft => "outlook",
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

    let (state, issued_for) = match verify_signed_state(raw, key, current_timestamp)
        .map_err(CallbackStateError::Signed)?
    {
        SignedState::AccountLink(state) => {
            let issued_for = state.provider;
            (CallbackState::AccountLink(state), issued_for)
        }
        SignedState::AdminConsent(state) => {
            let issued_for = state.provider;
            (CallbackState::AdminConsent(state), issued_for)
        }
    };
    if issued_for.as_str() != provider {
        return Err(CallbackStateError::ProviderMismatch { issued_for });
    }

    Ok(state)
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
    /// `True` when a Microsoft administrator granted tenant-wide consent.
    #[serde(default)]
    admin_consent: Option<String>,
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

/// Sends the administrator's browser back to the app with the result of a
/// tenant-wide consent request. Microsoft reports success with
/// `admin_consent=True` and a refusal with `error`; neither carries a code.
fn admin_consent_outcome(params: &Params, consent: &AdminConsentState) -> Response {
    let provider = provider_query_value(consent.provider);
    let granted = params
        .admin_consent
        .as_deref()
        .is_some_and(|value| value.eq_ignore_ascii_case("true"));
    let outcome: (&str, &str) = if granted {
        tracing::info!(provider, "admin consent granted");
        ("email_link_notice", "admin_consent_granted")
    } else {
        let failure =
            ConsentFailure::classify(params.error.as_deref(), params.error_description.as_deref());
        tracing::info!(
            provider,
            error = ?params.error,
            aadsts_code = params.error_description.as_deref().and_then(aadsts_code),
            outcome = failure.as_str(),
            "admin consent not granted"
        );
        ("email_link_error", failure.as_str())
    };
    account_link::build_return_redirect(&consent.original_url, &[outcome, ("provider", provider)])
        .unwrap_or_else(IntoResponse::into_response)
}

/// Answers a consent screen that came back without an authorization code.
///
/// A link flow started from a page in the app, which explains the outcome in
/// place, so it is sent back there with an `email_link_error`. Sign-in has no
/// such page and keeps the error body.
fn consent_failure_response(link_state: Option<&AccountLinkState>, params: &Params) -> Response {
    let failure =
        ConsentFailure::classify(params.error.as_deref(), params.error_description.as_deref());
    tracing::info!(
        error = ?params.error,
        error_reason = ?params.error_reason,
        aadsts_code = params.error_description.as_deref().and_then(aadsts_code),
        outcome = failure.as_str(),
        "oauth2 callback received without code"
    );

    if let Some(link_state) = link_state
        && let Some(original_url) = &link_state.original_url
    {
        return account_link::build_return_redirect(
            original_url,
            &[
                ("link_id", &link_state.link_id.to_string()),
                ("email_link_error", failure.as_str()),
                ("provider", provider_query_value(link_state.provider)),
            ],
        )
        .unwrap_or_else(IntoResponse::into_response);
    }

    error_response(
        StatusCode::BAD_REQUEST,
        "Sign-in failed. Please try again or contact support.",
    )
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
            (status = 303, description = "Back to the app with link identifiers, an `email_link_error`, or an `email_link_notice`"),
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

    let (link_state, state) = match state {
        CallbackState::AdminConsent(consent) => {
            return Ok(admin_consent_outcome(&params, &consent));
        }
        CallbackState::Login(state) => (None, state),
        CallbackState::AccountLink(link_state) => {
            let state = OAuthState::from(&link_state);
            (Some(link_state), state)
        }
    };

    let Some(code) = params.code.as_deref() else {
        return Ok(consent_failure_response(link_state.as_ref(), &params));
    };

    if let Some(link_state) = &link_state {
        verify_pending_link_owner(&ctx, link_state).await?;
    }

    match provider.as_str() {
        "google" => google::handler(&ctx, cookies, code, &state).await,
        "github" => github::handler(&ctx, cookies, code, &state)
            .await
            .map(|r| r.into_response())
            .map_err(|e| e.into_response()),
        "microsoft" => microsoft::handler(&ctx, code, &state).await,
        _ => Err(error_response(
            StatusCode::NOT_IMPLEMENTED,
            "oauth2 callback not implemented for this provider",
        )),
    }
}
