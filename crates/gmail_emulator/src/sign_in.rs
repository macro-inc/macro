//! "Sign in with Google": the page that stands in for Google's account
//! chooser and consent screen, the authorization code it hands back, the ID
//! token of the exchange and the userinfo endpoint.
//!
//! Every mailbox is a Google user. The page lists them; picking one is
//! signing in as that user and consenting to the scopes left checked.

use askama::Template;
use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Form, Json, Router};
use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};
use url::Url;

use crate::GmailEmulator;
use crate::fault::Route;
use crate::gate::{Params, mailbox_request, open_request};
use crate::gmail_routes::mailbox;
use crate::mailbox::Mailbox;
use crate::push::{ISSUER, SigningKey};
use crate::state::{Consent, State};

/// Google's path for the authorization endpoint on `accounts.google.com`.
pub(crate) const AUTHORIZATION_PATH: &str = "/o/oauth2/v2/auth";
/// Google's path for userinfo on `openidconnect.googleapis.com`.
pub(crate) const USERINFO_PATH: &str = "/v1/userinfo";
const OPENID_SCOPE: &str = "openid";
const EMAIL_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.email";
const PROFILE_SCOPE: &str = "https://www.googleapis.com/auth/userinfo.profile";
const ID_TOKEN_LIFETIME_SECONDS: i64 = 3600;
/// The form field naming the user picked.
const USER_FIELD: &str = "user";
/// The form field of a scope left checked.
const GRANTED_FIELD: &str = "granted";
/// The form field of the cancel button.
const CANCEL_FIELD: &str = "cancel";

type Emulator = AxumState<GmailEmulator>;
type Pairs = Vec<(String, String)>;

pub(crate) fn router() -> Router<GmailEmulator> {
    Router::new()
        .route(AUTHORIZATION_PATH, get(page).post(decide))
        .route(USERINFO_PATH, get(userinfo))
}

/// Google's canonical name for a scope: `email` and `profile` are short for
/// the userinfo scopes, and token responses name the long form.
fn canonical_scope(scope: &str) -> &str {
    match scope {
        "email" => EMAIL_SCOPE,
        "profile" => PROFILE_SCOPE,
        other => other,
    }
}

/// Whether a scope only identifies the user. The consent screen has no
/// checkbox for these.
fn is_identity_scope(scope: &str) -> bool {
    [OPENID_SCOPE, EMAIL_SCOPE, PROFILE_SCOPE].contains(&scope)
}

/// Whether a grant's scopes yield an ID token.
pub(crate) fn grants_id_token(scopes: &[String]) -> bool {
    scopes.iter().any(|scope| scope == OPENID_SCOPE)
}

/// What a client asked the authorization endpoint for.
struct AuthorizationRequest {
    client_id: String,
    redirect_uri: Url,
    /// Canonical names, in the order asked.
    scopes: Vec<String>,
    state: Option<String>,
    include_granted_scopes: bool,
    offline: bool,
    nonce: Option<String>,
}

/// Why the authorization endpoint shows an error instead of the chooser.
/// Google does not redirect back to the client for these.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
enum AuthorizationError {
    #[error("Missing required parameter: {0}")]
    Missing(&'static str),
    #[error("Invalid parameter value for redirect_uri: {0}")]
    RedirectUri(String),
    #[error("Invalid response_type: {0}. The emulator only issues authorization codes.")]
    ResponseType(String),
    #[error("The emulator has no user {0}")]
    UnknownUser(String),
}

impl AuthorizationRequest {
    fn parse(params: &Params) -> Result<Self, AuthorizationError> {
        let required = |name: &'static str| {
            params
                .get(name)
                .filter(|value| !value.is_empty())
                .ok_or(AuthorizationError::Missing(name))
        };

        let client_id = required("client_id")?.to_string();
        let redirect_uri = required("redirect_uri")?;
        let redirect_uri = Url::parse(redirect_uri)
            .map_err(|_| AuthorizationError::RedirectUri(redirect_uri.to_string()))?;
        let response_type = required("response_type")?;
        if response_type != "code" {
            return Err(AuthorizationError::ResponseType(response_type.to_string()));
        }

        let mut scopes: Vec<String> = Vec::new();
        for scope in required("scope")?.split_ascii_whitespace() {
            let scope = canonical_scope(scope).to_string();
            if !scopes.contains(&scope) {
                scopes.push(scope);
            }
        }

        Ok(Self {
            client_id,
            redirect_uri,
            scopes,
            state: params.get("state").map(str::to_string),
            include_granted_scopes: params.flag("include_granted_scopes"),
            offline: params.get("access_type") == Some("offline"),
            nonce: params.get("nonce").map(str::to_string),
        })
    }

    /// The scopes that get a checkbox on the page.
    fn optional_scopes(&self) -> Vec<String> {
        self.scopes
            .iter()
            .filter(|scope| !is_identity_scope(scope))
            .cloned()
            .collect()
    }

    /// Where the browser goes next: back to the client, with these
    /// parameters and the request's `state`.
    fn redirect(&self, parameters: &[(&str, &str)]) -> Response {
        let mut target = self.redirect_uri.clone();
        {
            let mut query = target.query_pairs_mut();
            for (name, value) in parameters {
                query.append_pair(name, value);
            }
            if let Some(state) = &self.state {
                query.append_pair("state", state);
            }
        }
        Redirect::to(target.as_str()).into_response()
    }
}

struct PageUser {
    email: String,
    name: String,
    initial: String,
}

#[derive(Template)]
#[template(path = "sign_in.html")]
struct SignInPage {
    client_id: String,
    redirect_host: String,
    users: Vec<PageUser>,
    optional_scopes: Vec<String>,
    /// The request's own parameters, posted back with the choice.
    request: Pairs,
}

#[derive(Template)]
#[template(path = "sign_in_error.html")]
struct ErrorPage {
    message: String,
}

fn error_page(error: &AuthorizationError) -> Response {
    let page = ErrorPage {
        message: error.to_string(),
    };
    match page.render() {
        Ok(html) => (StatusCode::BAD_REQUEST, Html(html)).into_response(),
        Err(render_error) => {
            tracing::error!(error = ?render_error, "sign-in error page did not render");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn sign_in_page(state: &State, request: &AuthorizationRequest, pairs: Pairs) -> Response {
    let users = state
        .mailboxes
        .values()
        .map(|mailbox| {
            let name = mailbox
                .name
                .clone()
                .unwrap_or_else(|| mailbox.email.clone());
            PageUser {
                initial: name.chars().take(1).collect::<String>().to_uppercase(),
                email: mailbox.email.clone(),
                name,
            }
        })
        .collect();
    let page = SignInPage {
        client_id: request.client_id.clone(),
        redirect_host: request
            .redirect_uri
            .host_str()
            .unwrap_or_default()
            .to_string(),
        users,
        optional_scopes: request.optional_scopes(),
        request: pairs,
    };

    match page.render() {
        Ok(html) => Html(html).into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "sign-in page did not render");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

/// `GET /o/oauth2/v2/auth`: the account chooser and consent screen.
async fn page(AxumState(emulator): Emulator, Query(pairs): Query<Pairs>) -> Response {
    open_request(&emulator, Route::OauthAuthorize, |state| {
        let response = match AuthorizationRequest::parse(&Params(pairs.clone())) {
            Ok(request) => sign_in_page(state, &request, pairs),
            Err(error) => error_page(&error),
        };
        (None, response)
    })
    .await
}

/// `POST /o/oauth2/v2/auth`: the page's form. Sends the browser back to the
/// client with an authorization code, or with `access_denied` on cancel.
async fn decide(AxumState(emulator): Emulator, Form(pairs): Form<Pairs>) -> Response {
    let params = Params(pairs);
    let request = match AuthorizationRequest::parse(&params) {
        Ok(request) => request,
        Err(error) => return error_page(&error),
    };

    open_request(&emulator, Route::OauthAuthorize, |state| {
        if params.get(CANCEL_FIELD).is_some() {
            return (None, request.redirect(&[("error", "access_denied")]));
        }
        let Some(user) = params.get(USER_FIELD) else {
            return (None, error_page(&AuthorizationError::Missing(USER_FIELD)));
        };

        let checked = params.all(GRANTED_FIELD);
        let scopes: Vec<String> = request
            .scopes
            .iter()
            .filter(|scope| is_identity_scope(scope) || checked.contains(scope))
            .cloned()
            .collect();
        let granted = scopes.join(" ");
        let consent = Consent {
            client_id: request.client_id.clone(),
            redirect_uri: request.redirect_uri.to_string(),
            scopes,
            include_granted_scopes: request.include_granted_scopes,
            offline: request.offline,
            nonce: request.nonce.clone(),
        };

        match state.authorize(user, consent) {
            Ok(code) => (
                Some(user.to_lowercase()),
                request.redirect(&[("code", &code), ("scope", &granted)]),
            ),
            Err(_) => (
                None,
                error_page(&AuthorizationError::UnknownUser(user.to_string())),
            ),
        }
    })
    .await
}

/// A mailbox's owner as OpenID Connect describes a user.
#[derive(Serialize)]
struct Profile {
    sub: String,
    email: String,
    email_verified: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    given_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    family_name: Option<String>,
}

/// The Google account id of a mailbox's owner: 21 digits, the same for the
/// same address in every emulator, so an identity linked to it survives a
/// restart.
pub(crate) fn subject(email: &str) -> String {
    let digest = Sha256::digest(email.as_bytes());
    let mut first = [0u8; 8];
    first.copy_from_slice(&digest[..8]);
    format!("1{:020}", u64::from_be_bytes(first))
}

fn profile(mailbox: &Mailbox) -> Profile {
    let (given_name, family_name) = match mailbox.name.as_deref().map(str::trim) {
        Some(name) => match name.split_once(' ') {
            Some((given, family)) => (Some(given.to_string()), Some(family.to_string())),
            None => (Some(name.to_string()), None),
        },
        None => (None, None),
    };

    Profile {
        sub: subject(&mailbox.email),
        email: mailbox.email.clone(),
        email_verified: true,
        name: mailbox.name.clone(),
        given_name,
        family_name,
    }
}

#[derive(Serialize)]
struct IdTokenClaims<'a> {
    iss: &'a str,
    azp: &'a str,
    aud: &'a str,
    #[serde(flatten)]
    profile: Profile,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<&'a str>,
    iat: i64,
    exp: i64,
}

/// Signs the ID token of a token response. Like push tokens it is dated by
/// the real clock, the one its verifier reads.
pub(crate) fn id_token(
    key: &SigningKey,
    mailbox: &Mailbox,
    client_id: &str,
    nonce: Option<&str>,
) -> Result<String, jsonwebtoken::errors::Error> {
    let issued_at = Utc::now().timestamp();

    key.sign(&IdTokenClaims {
        iss: ISSUER,
        azp: client_id,
        aud: client_id,
        profile: profile(mailbox),
        nonce,
        iat: issued_at,
        exp: issued_at + ID_TOKEN_LIFETIME_SECONDS,
    })
}

/// `GET /v1/userinfo`: the user an access token belongs to.
async fn userinfo(AxumState(emulator): Emulator, headers: HeaderMap) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::OauthUserInfo,
        |state, email| Ok(Json(profile(mailbox(state, email)?))),
    )
    .await
}
