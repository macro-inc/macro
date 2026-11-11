//! Axum router for the MCP OAuth broker.

#[cfg(test)]
mod test;

use std::time::Duration;

use askama::Template;
use axum::{
    Router,
    extract::{Query, RawQuery, State, rejection::FormRejection},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    middleware as axum_mw,
    response::{IntoResponse, Json, Redirect, Response},
    routing,
};
use axum_extra::extract::cookie::{Cookie, CookieJar, SameSite};
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use serde::Deserialize;
use tower_http::cors::{AllowOrigin, CorsLayer};

use crate::domain::{
    browser_binding::BrowserBinding,
    models::{
        AuthorizationStart, AuthorizeRequest, CallbackRequest, ClientDelivery,
        ClientRegistrationRequest, CodeDelivery, ConsentPrompt, EmailSignInStep, RevocationRequest,
        TokenRequest, UserConsent,
    },
    ports::{EmailCodeError, UpstreamGrantError},
    service::{
        CompleteCallbackError, EmailSignInError, InflightAuthStore, McpAuthProxyService,
        McpAuthProxyServiceImpl, RegisterClientError, RevokeTokenError, StartAuthorizationError,
        TokenExchangeError,
    },
};

/// Fetch metadata header naming how the request's initiator relates to this
/// origin; browsers set it on every request.
const SEC_FETCH_SITE: HeaderName = HeaderName::from_static("sec-fetch-site");

const INVALID_REDIRECT_URI: &str =
    "redirect_uri must be an https URL or an http URL on a loopback address";

/// Health check handler for ALB.
async fn health() -> &'static str {
    "ok"
}

async fn authorization_server_metadata<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
) -> Json<serde_json::Value> {
    Json(auth_proxy.authorization_server_metadata())
}

async fn protected_resource_metadata<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
) -> Json<serde_json::Value> {
    Json(auth_proxy.protected_resource_metadata())
}

async fn register<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Json(body): axum::Json<ClientRegistrationRequest>,
) -> Response {
    match auth_proxy.register_client(body).await {
        // RFC 7591 section 3.2.1 only says SHOULD for 201, and clients already
        // work against the 200 this endpoint has always returned.
        Ok(registration) => Json(registration).into_response(),
        Err(RegisterClientError::RedirectUrisRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "at least one redirect_uri is required",
        )
            .into_response(),
        Err(RegisterClientError::TooManyRedirectUris) => (
            axum::http::StatusCode::BAD_REQUEST,
            "too many redirect_uris",
        )
            .into_response(),
        Err(RegisterClientError::UnsupportedRedirectUri { uri }) => {
            tracing::warn!(
                rejected_redirect_uri = %uri,
                "client registration used a redirect_uri this deployment does not trust"
            );
            (axum::http::StatusCode::BAD_REQUEST, INVALID_REDIRECT_URI).into_response()
        }
        Err(RegisterClientError::ClientRegistrationStore(error)) => {
            tracing::error!(error=?error, "failed to persist client registration");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist client registration",
            )
                .into_response()
        }
    }
}

/// The broker's email sign-in page, relative to `/authorize`.
const EMAIL_SIGN_IN_PATH: &str = "email-sign-in";

/// Cookie carrying the browser's `BrowserBinding`. The `__Host-` prefix makes
/// browsers refuse it unless it is `Secure`, host-only and on `/`, so no
/// sibling domain can plant one.
const BROWSER_BINDING_COOKIE: &str = "__Host-macro_mcp_oauth";

/// The consent screen loads nothing, runs nothing, and cannot be framed, so a
/// page that overlays it cannot trick a click onto Allow.
const CONSENT_PAGE_CSP: &str =
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

const CONSENT_DECLINED_PAGE: &str = include_str!("../../templates/consent_declined.html");

#[derive(Template)]
#[template(path = "consent.html")]
struct ConsentPage<'a> {
    client_name: &'a str,
    redirect_host: &'a str,
    request: &'a AuthorizeRequest,
    consent_token: &'a str,
    manual_delivery: bool,
}

#[derive(Template)]
#[template(path = "sign_in_choice.html")]
struct SignInChoicePage {
    params: Vec<(String, String)>,
    offers_manual_delivery: bool,
}

#[derive(Template)]
#[template(path = "email_sign_in.html")]
struct EmailSignInPage<'a> {
    session: &'a str,
    form_token: &'a str,
    code_sent_to: Option<&'a str>,
    error: Option<&'a str>,
}

#[derive(Template)]
#[template(path = "manual_delivery.html")]
struct ManualDeliveryPage<'a> {
    url: &'a str,
}

/// What the user chose on the consent screen.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "lowercase")]
enum ConsentDecision {
    Approve,
    Deny,
}

/// The consent screen's form: the authorize request it was shown for, the
/// anti-forgery token, and the user's choice.
#[derive(Deserialize)]
struct ConsentSubmission {
    #[serde(flatten)]
    request: AuthorizeRequest,
    consent_token: String,
    decision: ConsentDecision,
}

fn browser_binding(jar: &CookieJar) -> Option<BrowserBinding> {
    jar.get(BROWSER_BINDING_COOKIE)
        .and_then(|cookie| BrowserBinding::parse(cookie.value()))
}

fn browser_binding_cookie(browser: &BrowserBinding) -> Cookie<'static> {
    // `Lax` still reaches the upstream's redirect back to `/oauth/callback`,
    // a top-level navigation, but not a cross-site form post.
    Cookie::build((BROWSER_BINDING_COOKIE, browser.as_str().to_owned()))
        .path("/")
        .secure(true)
        .http_only(true)
        .same_site(SameSite::Lax)
        .build()
}

/// Renders a template as a broker page, naming it in the log if it cannot be.
fn render_page(page: &impl Template, name: &'static str) -> Response {
    match page.render() {
        Ok(body) => html_page(body),
        Err(error) => {
            tracing::error!(error=?error, page = name, "failed to render a broker page");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to render the page",
            )
                .into_response()
        }
    }
}

/// A broker-rendered page with the headers that keep it from being framed,
/// cached, or leaking its URL.
fn html_page(body: String) -> Response {
    (
        [
            (header::CONTENT_TYPE, "text/html; charset=utf-8"),
            (header::CONTENT_SECURITY_POLICY, CONSENT_PAGE_CSP),
            (header::X_FRAME_OPTIONS, "DENY"),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff"),
            (header::CACHE_CONTROL, "no-store"),
            (header::REFERRER_POLICY, "no-referrer"),
        ],
        body,
    )
        .into_response()
}

/// The sign-in chooser, shown before any flow starts so it stores nothing.
/// Its form repeats the authorize request with the choices added.
fn sign_in_choice(query: Option<&str>, offers_manual_delivery: bool) -> Response {
    let params = url::form_urlencoded::parse(query.unwrap_or_default().as_bytes())
        .into_owned()
        .collect();

    render_page(
        &SignInChoicePage {
            params,
            offers_manual_delivery,
        },
        "sign_in_choice",
    )
}

fn consent_page(
    prompt: &ConsentPrompt,
    request: &AuthorizeRequest,
    browser: &BrowserBinding,
) -> Response {
    render_page(
        &ConsentPage {
            client_name: &prompt.client_name,
            redirect_host: &prompt.redirect_host,
            request,
            consent_token: &browser.form_token(),
            manual_delivery: prompt.delivery == CodeDelivery::Manual,
        },
        "consent",
    )
}

/// Sends a finished flow's callback URL to the client: by `redirect`, or by
/// showing it when the user is carrying it to another machine.
fn delivery_response(delivery: &ClientDelivery, redirect: fn(&str) -> Redirect) -> Response {
    match delivery.method {
        CodeDelivery::Redirect => redirect(&delivery.url).into_response(),
        CodeDelivery::Manual => render_page(
            &ManualDeliveryPage { url: &delivery.url },
            "manual_delivery",
        ),
    }
}

/// Answers an authorize request, or an approved consent form, with the
/// upstream sign-in or the consent screen. `redirect` builds the redirect to
/// the sign-in: a `307` for `GET /authorize`, a `303` after the form post.
async fn authorization_response<I: InflightAuthStore + 'static>(
    auth_proxy: &McpAuthProxyServiceImpl<I>,
    request: AuthorizeRequest,
    browser: BrowserBinding,
    consent: UserConsent,
    redirect: fn(&str) -> Redirect,
) -> Response {
    match auth_proxy
        .start_authorization(request.clone(), browser.clone(), consent)
        .await
    {
        // The browser carries the MCP client page's Referer across this
        // redirect, and FusionAuth rejects any Referer outside its first-party
        // origin list with "Invalid origin uri". The redirect URI policy has
        // already vetted the client, so the client's origin is withheld.
        Ok(AuthorizationStart::SignIn(url)) => {
            ([(header::REFERRER_POLICY, "no-referrer")], redirect(&url)).into_response()
        }
        // Relative, so it stays under the prefix the gateway mounted this on.
        Ok(AuthorizationStart::EmailSignIn { session_id }) => {
            redirect(&format!("{EMAIL_SIGN_IN_PATH}?session={session_id}")).into_response()
        }
        Ok(AuthorizationStart::ConsentRequired(prompt)) => {
            consent_page(&prompt, &request, &browser)
        }
        Err(error) => start_authorization_error_response(error),
    }
}

async fn authorize<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    RawQuery(query): RawQuery,
    Query(params): Query<AuthorizeRequest>,
) -> Response {
    if params.sign_in.is_none() {
        let offers_manual_delivery = auth_proxy.allows_manual_delivery(&params.redirect_uri);
        return sign_in_choice(query.as_deref(), offers_manual_delivery);
    }

    let browser = browser_binding(&jar).unwrap_or_else(BrowserBinding::generate);
    let jar = jar.add(browser_binding_cookie(&browser));

    let response = authorization_response(
        &auth_proxy,
        params,
        browser,
        UserConsent::NotAsked,
        Redirect::temporary,
    )
    .await;
    (jar, response).into_response()
}

/// The browser submitting one of the broker's forms, provided it is the one
/// that was shown the form: the browser binding cookie must be present (a
/// cross-site post does not carry a `SameSite=Lax` cookie) and the form's token
/// must be the one derived from it, which a page on another origin cannot read.
fn form_browser(jar: &CookieJar, headers: &HeaderMap, form_token: &str) -> Option<BrowserBinding> {
    let cross_site = headers
        .get(SEC_FETCH_SITE)
        .is_some_and(|site| site.as_bytes() != b"same-origin");
    if cross_site {
        return None;
    }

    browser_binding(jar).filter(|browser| browser.accepts_form_token(form_token))
}

/// Receives the consent screen's form.
async fn submit_consent<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::Form(submission): axum::Form<ConsentSubmission>,
) -> Response {
    let Some(browser) = form_browser(&jar, &headers, &submission.consent_token) else {
        tracing::warn!(
            client_id = %submission.request.client_id,
            "consent form submission could not be verified"
        );
        return (
            axum::http::StatusCode::FORBIDDEN,
            "This approval could not be verified. Start connecting again from the app you \
             are connecting.",
        )
            .into_response();
    };

    match submission.decision {
        ConsentDecision::Deny => {
            tracing::info!(client_id = %submission.request.client_id, "user declined an MCP client");
            html_page(CONSENT_DECLINED_PAGE.to_owned())
        }
        ConsentDecision::Approve => {
            authorization_response(
                &auth_proxy,
                submission.request,
                browser,
                UserConsent::Approved,
                Redirect::to,
            )
            .await
        }
    }
}

/// The session an email sign-in page belongs to.
#[derive(Deserialize)]
struct EmailSignInQuery {
    session: String,
}

/// The email sign-in form: an address alone asks for a code, and an address
/// with a code redeems it.
#[derive(Deserialize)]
struct EmailSignInSubmission {
    session: String,
    form_token: String,
    email: String,
    #[serde(default)]
    code: Option<String>,
}

fn email_sign_in_page(
    session: &str,
    browser: &BrowserBinding,
    code_sent_to: Option<&str>,
    error: Option<&str>,
) -> Response {
    render_page(
        &EmailSignInPage {
            session,
            form_token: &browser.form_token(),
            code_sent_to,
            error,
        },
        "email_sign_in",
    )
}

/// What the user is told about a refused step, or `None` when the page cannot
/// help and the flow has to be answered as an error.
fn email_code_refusal(error: &EmailSignInError) -> Option<&'static str> {
    let EmailSignInError::EmailCode(error) = error else {
        return None;
    };

    match error {
        EmailCodeError::InvalidEmail => Some("Enter a valid email address."),
        EmailCodeError::NotAllowed => Some("That email address can't sign in to Macro."),
        EmailCodeError::InvalidCode => Some("That code isn't right, or it has expired."),
        EmailCodeError::RateLimited => Some("Too many attempts. Wait a minute and try again."),
        EmailCodeError::Unavailable(_) => None,
    }
}

fn email_sign_in_error_response(error: EmailSignInError) -> Response {
    match error {
        EmailSignInError::UnknownOrExpiredSession => (
            axum::http::StatusCode::BAD_REQUEST,
            "This sign-in has expired. Start connecting again from the app you are connecting.",
        )
            .into_response(),
        EmailSignInError::DifferentBrowser => (
            axum::http::StatusCode::BAD_REQUEST,
            "This sign-in was started in a different browser. Start connecting again from the \
             app you are connecting, and finish signing in in the browser it opens.",
        )
            .into_response(),
        EmailSignInError::EmailCode(error) => {
            tracing::error!(error=?error, "email sign-in step failed");
            (
                axum::http::StatusCode::BAD_GATEWAY,
                "Email sign-in is unavailable right now. Try again shortly.",
            )
                .into_response()
        }
        EmailSignInError::InflightStore(error) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        EmailSignInError::ConstructAuthorizeUrl(error) => {
            tracing::error!(error=?error, "failed to construct upstream authorize URL");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to construct authorize URL",
            )
                .into_response()
        }
    }
}

/// Shows the email form for a session this browser started.
async fn show_email_sign_in<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    Query(query): Query<EmailSignInQuery>,
) -> Response {
    let Some(browser) = browser_binding(&jar) else {
        return email_sign_in_error_response(EmailSignInError::DifferentBrowser);
    };

    match auth_proxy
        .check_email_sign_in(&query.session, &browser)
        .await
    {
        Ok(()) => email_sign_in_page(&query.session, &browser, None, None),
        Err(error) => email_sign_in_error_response(error),
    }
}

/// Receives the email form: asks for a code, or redeems one.
async fn submit_email_sign_in<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    headers: HeaderMap,
    axum::Form(submission): axum::Form<EmailSignInSubmission>,
) -> Response {
    let Some(browser) = form_browser(&jar, &headers, &submission.form_token) else {
        tracing::warn!(
            session_id = %submission.session,
            "email sign-in submission could not be verified"
        );
        return (
            axum::http::StatusCode::FORBIDDEN,
            "This sign-in could not be verified. Start connecting again from the app you are \
             connecting.",
        )
            .into_response();
    };
    let EmailSignInSubmission {
        session,
        email,
        code,
        ..
    } = submission;

    match code {
        Some(code) => {
            match auth_proxy
                .verify_email_code(&session, &email, &code, &browser)
                .await
            {
                Ok(delivery) => delivery_response(&delivery, Redirect::to),
                Err(error) => match email_code_refusal(&error) {
                    Some(refusal) => {
                        email_sign_in_page(&session, &browser, Some(&email), Some(refusal))
                    }
                    None => email_sign_in_error_response(error),
                },
            }
        }
        None => match auth_proxy
            .request_email_code(&session, &email, &browser)
            .await
        {
            Ok(EmailSignInStep::EnterCode) => {
                email_sign_in_page(&session, &browser, Some(&email), None)
            }
            Ok(EmailSignInStep::Sso(url)) => (
                [(header::REFERRER_POLICY, "no-referrer")],
                Redirect::to(&url),
            )
                .into_response(),
            Err(error) => match email_code_refusal(&error) {
                Some(refusal) => email_sign_in_page(&session, &browser, None, Some(refusal)),
                None => email_sign_in_error_response(error),
            },
        },
    }
}

fn start_authorization_error_response(error: StartAuthorizationError) -> Response {
    match error {
        StartAuthorizationError::ManualDeliveryUnavailable => (
            axum::http::StatusCode::BAD_REQUEST,
            "This app can't finish signing in on another machine.",
        )
            .into_response(),
        StartAuthorizationError::UnsupportedResponseType => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported response_type",
        )
            .into_response(),
        StartAuthorizationError::UnsupportedCodeChallengeMethod => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported code_challenge_method",
        )
            .into_response(),
        StartAuthorizationError::InvalidRedirectUri => {
            (axum::http::StatusCode::BAD_REQUEST, INVALID_REDIRECT_URI).into_response()
        }

        StartAuthorizationError::UnregisteredRedirectUri => (
            axum::http::StatusCode::BAD_REQUEST,
            "redirect_uri was not registered for this client",
        )
            .into_response(),
        StartAuthorizationError::UnknownClient => (
            axum::http::StatusCode::BAD_REQUEST,
            "Your Macro connection needs to be reconnected. In the app you are connecting from, \
             remove the Macro MCP connection, add it again, and sign in to Macro. \
             Signing in again without removing the connection may reuse the old registration.",
        )
            .into_response(),
        StartAuthorizationError::ClientRegistrationStore(error) => {
            tracing::error!(error=?error, "failed to read client registrations");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to read client registrations",
            )
                .into_response()
        }
        StartAuthorizationError::InflightStore(error) => {
            tracing::error!(error=?error, "failed to persist inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to persist inflight auth state",
            )
                .into_response()
        }
        StartAuthorizationError::ConstructAuthorizeUrl(error) => {
            tracing::error!(error=?error, "failed to construct upstream authorize URL");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to construct authorize URL",
            )
                .into_response()
        }
    }
}

async fn oauth_callback<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    jar: CookieJar,
    Query(params): Query<CallbackRequest>,
) -> Response {
    match auth_proxy
        .complete_callback(params, browser_binding(&jar))
        .await
    {
        Ok(delivery) => delivery_response(&delivery, Redirect::temporary),
        Err(CompleteCallbackError::MissingState) => {
            tracing::warn!("no state parameter in upstream OAuth callback");
            (
                axum::http::StatusCode::BAD_REQUEST,
                "missing state parameter",
            )
                .into_response()
        }
        Err(CompleteCallbackError::MissingCode) => {
            tracing::warn!("upstream OAuth callback missing both code and error");
            (
                axum::http::StatusCode::BAD_REQUEST,
                "missing code parameter",
            )
                .into_response()
        }
        Err(CompleteCallbackError::UnknownOrExpiredSession) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unknown or expired session",
        )
            .into_response(),
        Err(CompleteCallbackError::DifferentBrowser) => (
            axum::http::StatusCode::BAD_REQUEST,
            "This sign-in was started in a different browser. Start connecting again from the \
             app you are connecting, and finish signing in in the browser it opens.",
        )
            .into_response(),
        Err(CompleteCallbackError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                axum::http::StatusCode::INTERNAL_SERVER_ERROR,
                "failed to access inflight auth state",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::InvalidGrant { .. },
        )) => {
            tracing::warn!(%error, "upstream refused the authorization code");
            (
                StatusCode::BAD_REQUEST,
                "sign-in could not be completed; start the connection again",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::Unavailable { .. },
        )) => {
            tracing::error!(%error, "upstream authorization code grant failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                "the sign-in service is temporarily unavailable; try again shortly",
            )
                .into_response()
        }
        Err(CompleteCallbackError::AuthorizationCodeExchangeFailed(
            error @ UpstreamGrantError::Failed(_),
        )) => {
            tracing::error!(%error, "upstream authorization code grant failed");
            (
                StatusCode::BAD_GATEWAY,
                "authorization code exchange failed",
            )
                .into_response()
        }
    }
}

/// An RFC 6749 section 5.2 error response.
fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    (
        status,
        [(header::CACHE_CONTROL, "no-store")],
        Json(serde_json::json!({ "error": error, "error_description": description })),
    )
        .into_response()
}

/// Token endpoint. Errors use the RFC 6749 section 5.2 JSON shape so clients
/// can tell a grant they must discard (`invalid_grant`, 400) from a fault
/// worth retrying (5xx).
async fn token<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    params: Result<axum::Form<TokenRequest>, FormRejection>,
) -> Response {
    let Ok(axum::Form(params)) = params else {
        return oauth_error(
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "the request must be a form with a grant_type",
        );
    };
    let (status, error, description) = match auth_proxy.exchange_token(params).await {
        Ok(response) => return Json(response).into_response(),
        Err(TokenExchangeError::UnsupportedGrantType) => (
            StatusCode::BAD_REQUEST,
            "unsupported_grant_type",
            "unsupported grant_type",
        ),
        Err(TokenExchangeError::CodeRequired) => {
            (StatusCode::BAD_REQUEST, "invalid_request", "code required")
        }
        Err(TokenExchangeError::RedirectUriRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "redirect_uri required",
        ),
        Err(TokenExchangeError::CodeVerifierRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "code_verifier required",
        ),
        Err(TokenExchangeError::RefreshTokenRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "refresh_token required",
        ),
        Err(TokenExchangeError::ClientIdRequired) => (
            StatusCode::BAD_REQUEST,
            "invalid_request",
            "client_id required",
        ),
        Err(TokenExchangeError::InvalidOrExpiredCode) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "invalid or expired code",
        ),
        Err(TokenExchangeError::RedirectUriMismatch) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "redirect_uri mismatch",
        ),
        Err(TokenExchangeError::PkceVerificationFailed) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "PKCE verification failed",
        ),
        Err(TokenExchangeError::ClientMismatch) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "grant was not issued to this client",
        ),
        Err(TokenExchangeError::UnboundRefreshToken) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token is not bound to a client",
        ),
        Err(TokenExchangeError::RevokedGrant) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token has been revoked",
        ),
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::InvalidGrant { .. })) => (
            StatusCode::BAD_REQUEST,
            "invalid_grant",
            "refresh token is no longer valid; authorize again",
        ),
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::Unavailable { retry_after })) => {
            let mut response = oauth_error(
                StatusCode::SERVICE_UNAVAILABLE,
                "temporarily_unavailable",
                "the sign-in service is temporarily unavailable; try again shortly",
            );
            if let Some(retry_after) = retry_after {
                response.headers_mut().insert(
                    header::RETRY_AFTER,
                    HeaderValue::from(retry_after.as_secs()),
                );
            }
            return response;
        }
        Err(TokenExchangeError::RefreshFailed(UpstreamGrantError::Failed(_))) => (
            StatusCode::BAD_GATEWAY,
            "server_error",
            "refresh token exchange failed",
        ),
        Err(TokenExchangeError::InflightStore(error)) => {
            tracing::error!(error=?error, "failed to access inflight auth state");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to access inflight auth state",
            )
        }
        Err(TokenExchangeError::ClientRegistrationStore(error)) => {
            tracing::error!(error=?error, "failed to read client registrations");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to read client registrations",
            )
        }
        Err(TokenExchangeError::MintAccessToken(error)) => {
            tracing::error!(error=?error, "failed to mint the resource's access token");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to issue the access token",
            )
        }
        Err(TokenExchangeError::RefreshTokenBindingStore(error)) => {
            tracing::error!(error=?error, "failed to access refresh token bindings");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "server_error",
                "failed to access refresh token bindings",
            )
        }
    };
    oauth_error(status, error, description)
}

/// RFC 7009 revocation endpoint. Errors use the RFC 6749 section 5.2 JSON
/// shape that RFC 7009 section 2.2.1 refers to.
async fn revoke<I: InflightAuthStore + 'static>(
    State(auth_proxy): State<McpAuthProxyServiceImpl<I>>,
    axum::Form(params): axum::Form<RevocationRequest>,
) -> Response {
    let (status, error, description) = match auth_proxy.revoke_token(params).await {
        Ok(()) => return axum::http::StatusCode::OK.into_response(),
        Err(RevokeTokenError::ClientIdRequired) => (
            axum::http::StatusCode::UNAUTHORIZED,
            "invalid_client",
            "client_id required",
        ),
        Err(RevokeTokenError::TokenRequired) => (
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_request",
            "token required",
        ),
        Err(RevokeTokenError::UnsupportedTokenType) => (
            axum::http::StatusCode::BAD_REQUEST,
            "unsupported_token_type",
            "access tokens cannot be revoked; revoke the refresh token instead",
        ),
        Err(RevokeTokenError::ClientMismatch) => (
            axum::http::StatusCode::BAD_REQUEST,
            "invalid_grant",
            "token was not issued to this client",
        ),
        Err(RevokeTokenError::RefreshTokenBindingStore(error)) => {
            tracing::error!(error=?error, "failed to access refresh token bindings");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "server_error",
                "failed to access refresh token bindings",
            )
        }
        Err(RevokeTokenError::UpstreamRevocationFailed(error)) => {
            tracing::error!(error=?error, "upstream refresh token revocation failed");
            (
                axum::http::StatusCode::SERVICE_UNAVAILABLE,
                "server_error",
                "upstream refresh token revocation failed",
            )
        }
    };
    oauth_error(status, error, description)
}

/// Builds the unauthenticated OAuth broker routes: discovery metadata,
/// dynamic client registration, authorize, upstream callback, token, and
/// revocation.
pub fn oauth_router<I>(auth_proxy: McpAuthProxyServiceImpl<I>) -> Router
where
    I: InflightAuthStore + 'static,
{
    oauth_routes(auth_proxy).route("/health", routing::get(health))
}

fn oauth_routes<I: InflightAuthStore + 'static>(auth_proxy: McpAuthProxyServiceImpl<I>) -> Router {
    Router::new()
        .route(
            "/.well-known/oauth-protected-resource",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-protected-resource/mcp",
            routing::get(protected_resource_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server",
            routing::get(authorization_server_metadata),
        )
        .route(
            "/.well-known/oauth-authorization-server/mcp",
            routing::get(authorization_server_metadata),
        )
        .route("/authorize", routing::get(authorize).post(submit_consent))
        .route(
            &format!("/{EMAIL_SIGN_IN_PATH}"),
            routing::get(show_email_sign_in).post(submit_email_sign_in),
        )
        .route("/register", routing::post(register))
        .route("/oauth/callback", routing::get(oauth_callback))
        .route("/token", routing::post(token))
        .route("/revoke", routing::post(revoke))
        .with_state(auth_proxy)
}

/// Builds the complete MCP router: unauthenticated OAuth broker routes plus
/// the Bearer-protected `/mcp` service route.
pub fn mcp_router<I, S>(
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
    mcp_service: S,
) -> Router
where
    I: InflightAuthStore + 'static,
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    {
        let clients = auth_proxy.access_token_clients();
        mcp_router_with_oauth(
            oauth_router(auth_proxy),
            super::middleware::BearerAuth { jwt_args, clients },
            mcp_service,
        )
    }
}

/// MCP routes for a shared HTTP listener whose process owns health checks.
pub fn mounted_mcp_router<I, S>(
    auth_proxy: McpAuthProxyServiceImpl<I>,
    jwt_args: JwtValidationArgs,
    mcp_service: S,
) -> Router
where
    I: InflightAuthStore + 'static,
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    {
        let clients = auth_proxy.access_token_clients();
        mcp_router_with_oauth(
            oauth_routes(auth_proxy),
            super::middleware::BearerAuth { jwt_args, clients },
            mcp_service,
        )
    }
}

fn mcp_router_with_oauth<S>(
    oauth: Router,
    auth: super::middleware::BearerAuth,
    mcp_service: S,
) -> Router
where
    S: tower::Service<axum::http::Request<axum::body::Body>, Error = std::convert::Infallible>
        + Clone
        + Send
        + Sync
        + 'static,
    S::Response: axum::response::IntoResponse,
    S::Future: Send + 'static,
{
    let mcp_route =
        Router::new()
            .nest_service("/mcp", mcp_service)
            .layer(axum_mw::from_fn_with_state(
                auth,
                super::middleware::validate_bearer,
            ));

    mount_at_root_and_prefix(oauth.merge(mcp_route)).layer(mcp_cors_layer())
}

fn mount_at_root_and_prefix(inner: Router) -> Router {
    Router::new()
        .merge(inner.clone())
        .nest(super::GATEWAY_PATH_PREFIX, inner)
}

/// CORS layer for the MCP router.
///
/// Applied outside the bearer middleware so OPTIONS preflights short-circuit
/// to 204 (never hitting auth) and 401 challenges still carry CORS headers —
/// both required for browser clients like claude.ai to complete the OAuth
/// dance over the MCP streamable HTTP transport.
fn mcp_cors_layer() -> CorsLayer {
    CorsLayer::new()
        .allow_origin(AllowOrigin::mirror_request())
        .allow_credentials(true)
        .allow_methods([Method::GET, Method::POST, Method::DELETE, Method::OPTIONS])
        .allow_headers([
            header::CONTENT_TYPE,
            header::AUTHORIZATION,
            HeaderName::from_static("mcp-protocol-version"),
            HeaderName::from_static("mcp-session-id"),
        ])
        .expose_headers([
            HeaderName::from_static("mcp-session-id"),
            header::WWW_AUTHENTICATE,
        ])
        .max_age(Duration::from_secs(3600))
}
