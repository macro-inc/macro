//! "Sign in with Microsoft": the page that stands in for Microsoft's account
//! picker and consent screen, the admin-consent page, the authorization code
//! they hand back, the ID token of the exchange, and the OpenID discovery
//! document, signing keys and userinfo endpoint that go with it.
//!
//! Every mailbox is a Microsoft user. The page lists them; picking one is
//! signing in as that user and accepting the permissions asked for.

use askama::Template;
use axum::extract::{Path, Query, State as AxumState};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{Html, IntoResponse, Redirect, Response};
use axum::routing::get;
use axum::{Form, Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use chrono::Utc;
use serde::Serialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use url::Url;

use crate::OutlookEmulator;
use crate::fault::Route;
use crate::graph::{bearer, logged, response};
use crate::mailbox::Mailbox;
use crate::signing_key::SigningKey;
use crate::state::{Consent, State};

/// The host every Microsoft issuer is named after. The emulator's tokens
/// carry Microsoft's issuer, as its discovery document says, wherever the
/// emulator itself listens.
const ISSUER_HOST: &str = "https://login.microsoftonline.com";
/// The tenant names that admit accounts of more than one directory. Their
/// discovery document and keys name the issuer as a template.
const SHARED_TENANTS: [&str; 3] = ["common", "organizations", "consumers"];
const TENANT_TEMPLATE: &str = "{tenantid}";
const OPENID_SCOPE: &str = "openid";
const PROFILE_SCOPE: &str = "profile";
const EMAIL_SCOPE: &str = "email";
pub(crate) const OFFLINE_ACCESS_SCOPE: &str = "offline_access";
const ID_TOKEN_LIFETIME_SECONDS: i64 = 3600;
/// The form field naming the user picked.
const USER_FIELD: &str = "user";
/// The form field of the cancel button.
const CANCEL_FIELD: &str = "cancel";
/// The form field of the button that answers "Need admin approval".
const ADMIN_APPROVAL_FIELD: &str = "admin_approval";
/// The form field of the admin-consent page's accept button.
const ACCEPT_FIELD: &str = "accept";
const ACCESS_DENIED: &str = "access_denied";
const DECLINED: &str = "AADSTS65004: User declined to consent to access the app.";
const NEEDS_ADMIN_APPROVAL: &str = "AADSTS65001: The user or administrator has not consented to use the application. \
     Send an interactive authorization request for this user and resource.";

type Emulator = AxumState<OutlookEmulator>;
type Pairs = Vec<(String, String)>;

pub(crate) fn router() -> Router<OutlookEmulator> {
    Router::new()
        .route("/{tenant}/oauth2/v2.0/authorize", get(page).post(decide))
        .route(
            "/{tenant}/v2.0/adminconsent",
            get(admin_consent_page).post(admin_consent_decide),
        )
        .route(
            "/{tenant}/v2.0/.well-known/openid-configuration",
            get(discovery),
        )
        .route("/{tenant}/discovery/v2.0/keys", get(keys))
        .route("/oidc/userinfo", get(userinfo).post(userinfo))
}

/// The issuer of a tenant's tokens: `{tenantid}` in place of the id for a
/// tenant name that admits many directories.
fn issuer(tenant: &str) -> String {
    let tenant = match SHARED_TENANTS.contains(&tenant) {
        true => TENANT_TEMPLATE,
        false => tenant,
    };
    format!("{ISSUER_HOST}/{tenant}/v2.0")
}

/// Whether a scope only identifies the user or keeps the grant alive. The
/// page lists the others as the permissions asked for.
fn is_identity_scope(scope: &str) -> bool {
    [
        OPENID_SCOPE,
        PROFILE_SCOPE,
        EMAIL_SCOPE,
        OFFLINE_ACCESS_SCOPE,
    ]
    .contains(&scope)
}

fn first<'a>(pairs: &'a Pairs, name: &str) -> Option<&'a str> {
    pairs
        .iter()
        .find(|(key, _)| key == name)
        .map(|(_, value)| value.as_str())
        .filter(|value| !value.is_empty())
}

/// Why a page shows an error instead of sending the browser back to the
/// client. Microsoft does not redirect for these.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
enum AuthorizationError {
    #[error("AADSTS900144: The request body must contain the following parameter: '{0}'.")]
    Missing(&'static str),
    #[error("AADSTS50011: The redirect URI '{0}' is not a valid URI.")]
    RedirectUri(String),
    #[error(
        "AADSTS700054: response_type '{0}' is not enabled. The emulator only issues authorization codes."
    )]
    ResponseType(String),
    #[error(
        "AADSTS90014: response_mode '{0}' is not supported. The emulator only answers in the query."
    )]
    ResponseMode(String),
    #[error(
        "AADSTS9002325: code_challenge_method '{0}' is not supported. The emulator verifies S256."
    )]
    ChallengeMethod(String),
    #[error("AADSTS50034: The user account {0} does not exist in the emulator.")]
    UnknownUser(String),
}

/// The client and return address of a page request, and its scopes.
struct PageRequest {
    client_id: String,
    redirect_uri: Url,
    /// In the order asked, each once.
    scopes: Vec<String>,
    state: Option<String>,
}

impl PageRequest {
    fn parse(pairs: &Pairs) -> Result<Self, AuthorizationError> {
        let required =
            |name: &'static str| first(pairs, name).ok_or(AuthorizationError::Missing(name));

        let client_id = required("client_id")?.to_string();
        let redirect_uri = required("redirect_uri")?;
        let redirect_uri = Url::parse(redirect_uri)
            .map_err(|_| AuthorizationError::RedirectUri(redirect_uri.to_string()))?;

        let mut scopes: Vec<String> = Vec::new();
        for scope in required("scope")?.split_ascii_whitespace() {
            if !scopes.iter().any(|known| known == scope) {
                scopes.push(scope.to_string());
            }
        }

        Ok(Self {
            client_id,
            redirect_uri,
            scopes,
            state: first(pairs, "state").map(str::to_string),
        })
    }

    /// The scopes the page lists as permissions.
    fn permissions(&self) -> Vec<String> {
        self.scopes
            .iter()
            .filter(|scope| !is_identity_scope(scope))
            .cloned()
            .collect()
    }

    fn redirect_host(&self) -> String {
        self.redirect_uri.host_str().unwrap_or_default().to_string()
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

    fn refused(&self, description: &str) -> Response {
        self.redirect(&[("error", ACCESS_DENIED), ("error_description", description)])
    }
}

/// What a client asked the authorization endpoint for.
struct AuthorizationRequest {
    page: PageRequest,
    nonce: Option<String>,
    code_challenge: Option<String>,
}

impl AuthorizationRequest {
    fn parse(pairs: &Pairs) -> Result<Self, AuthorizationError> {
        let page = PageRequest::parse(pairs)?;
        let response_type =
            first(pairs, "response_type").ok_or(AuthorizationError::Missing("response_type"))?;
        if response_type != "code" {
            return Err(AuthorizationError::ResponseType(response_type.to_string()));
        }
        if let Some(mode) = first(pairs, "response_mode").filter(|mode| *mode != "query") {
            return Err(AuthorizationError::ResponseMode(mode.to_string()));
        }
        let code_challenge = first(pairs, "code_challenge").map(str::to_string);
        let method = first(pairs, "code_challenge_method").unwrap_or("plain");
        if code_challenge.is_some() && method != "S256" {
            return Err(AuthorizationError::ChallengeMethod(method.to_string()));
        }

        Ok(Self {
            page,
            nonce: first(pairs, "nonce").map(str::to_string),
            code_challenge,
        })
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
    permissions: Vec<String>,
    /// The request's own parameters, posted back with the choice.
    request: Pairs,
}

#[derive(Template)]
#[template(path = "admin_consent.html")]
struct AdminConsentPage {
    client_id: String,
    redirect_host: String,
    permissions: Vec<String>,
    /// The request's own parameters, posted back with the choice.
    request: Pairs,
}

#[derive(Template)]
#[template(path = "sign_in_error.html")]
struct ErrorPage {
    message: String,
}

fn rendered(page: &impl Template, status: StatusCode) -> Response {
    match page.render() {
        Ok(html) => (status, Html(html)).into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "sign-in page did not render");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

fn error_page(error: &AuthorizationError) -> Response {
    let page = ErrorPage {
        message: error.to_string(),
    };
    rendered(&page, StatusCode::BAD_REQUEST)
}

fn sign_in_page(state: &State, request: &PageRequest, pairs: Pairs) -> Response {
    let users = state
        .mailboxes
        .values()
        .map(|mailbox| PageUser {
            initial: mailbox
                .name
                .chars()
                .take(1)
                .collect::<String>()
                .to_uppercase(),
            email: mailbox.email.clone(),
            name: mailbox.name.clone(),
        })
        .collect();
    let page = SignInPage {
        client_id: request.client_id.clone(),
        redirect_host: request.redirect_host(),
        users,
        permissions: request.permissions(),
        request: pairs,
    };
    rendered(&page, StatusCode::OK)
}

/// `GET /{tenant}/oauth2/v2.0/authorize`: the account picker and consent
/// screen.
async fn page(AxumState(emulator): Emulator, Query(pairs): Query<Pairs>) -> Response {
    let answered = emulator.with_state(|state| match AuthorizationRequest::parse(&pairs) {
        Ok(request) => sign_in_page(state, &request.page, pairs),
        Err(error) => error_page(&error),
    });
    logged(answered, Some(Route::OauthAuthorize), None)
}

/// `POST /{tenant}/oauth2/v2.0/authorize`: the page's form. Sends the
/// browser back to the client with an authorization code, or with
/// `access_denied` when the user cancels or needs an administrator.
async fn decide(AxumState(emulator): Emulator, Form(pairs): Form<Pairs>) -> Response {
    let request = match AuthorizationRequest::parse(&pairs) {
        Ok(request) => request,
        Err(error) => return logged(error_page(&error), Some(Route::OauthAuthorize), None),
    };

    let (mailbox, answered) = emulator.with_state(|state| {
        if first(&pairs, CANCEL_FIELD).is_some() {
            return (None, request.page.refused(DECLINED));
        }
        if first(&pairs, ADMIN_APPROVAL_FIELD).is_some() {
            return (None, request.page.refused(NEEDS_ADMIN_APPROVAL));
        }
        let Some(user) = first(&pairs, USER_FIELD) else {
            return (None, error_page(&AuthorizationError::Missing(USER_FIELD)));
        };

        let consent = Consent {
            client_id: request.page.client_id.clone(),
            redirect_uri: request.page.redirect_uri.to_string(),
            scopes: request.page.scopes.clone(),
            nonce: request.nonce.clone(),
            code_challenge: request.code_challenge.clone(),
        };
        match state.authorize(user, consent) {
            Ok(code) => {
                let session = uuid::Uuid::now_v7().to_string();
                let redirect = request
                    .page
                    .redirect(&[("code", &code), ("session_state", &session)]);
                (Some(user.to_lowercase()), redirect)
            }
            Err(_) => (
                None,
                error_page(&AuthorizationError::UnknownUser(user.to_string())),
            ),
        }
    });
    logged(answered, Some(Route::OauthAuthorize), mailbox)
}

/// `GET /{tenant}/v2.0/adminconsent`: the page an administrator approves
/// the application on for a whole directory.
async fn admin_consent_page(Query(pairs): Query<Pairs>) -> Response {
    let answered = match PageRequest::parse(&pairs) {
        Ok(request) => {
            let page = AdminConsentPage {
                client_id: request.client_id.clone(),
                redirect_host: request.redirect_host(),
                permissions: request.permissions(),
                request: pairs,
            };
            rendered(&page, StatusCode::OK)
        }
        Err(error) => error_page(&error),
    };
    logged(answered, Some(Route::OauthAdminConsent), None)
}

/// `POST /{tenant}/v2.0/adminconsent`: the page's form. Sends the browser
/// back with `admin_consent=True` and the directory's id, or with
/// `access_denied`.
async fn admin_consent_decide(AxumState(emulator): Emulator, Form(pairs): Form<Pairs>) -> Response {
    let answered = match PageRequest::parse(&pairs) {
        Ok(request) if first(&pairs, ACCEPT_FIELD).is_some() => {
            let tenant = emulator.with_state(|state| {
                state
                    .mailboxes
                    .values()
                    .next()
                    .map(|mailbox| mailbox.tenant_id.clone())
                    .unwrap_or_default()
            });
            let scope = request.scopes.join(" ");
            request.redirect(&[
                ("admin_consent", "True"),
                ("tenant", &tenant),
                ("scope", &scope),
            ])
        }
        Ok(request) => request.refused(DECLINED),
        Err(error) => error_page(&error),
    };
    logged(answered, Some(Route::OauthAdminConsent), None)
}

/// `GET /{tenant}/v2.0/.well-known/openid-configuration`. The endpoints a
/// service calls are on the origin services reach the emulator at; the
/// authorization endpoint is on the origin a browser reaches it at.
async fn discovery(AxumState(emulator): Emulator, Path(tenant): Path<String>) -> Response {
    let base = emulator.base_url();
    let browser = emulator.browser_url();
    let document = json!({
        "token_endpoint": format!("{base}/{tenant}/oauth2/v2.0/token"),
        "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"],
        "jwks_uri": format!("{base}/{tenant}/discovery/v2.0/keys"),
        "response_modes_supported": ["query"],
        "subject_types_supported": ["pairwise"],
        "id_token_signing_alg_values_supported": ["RS256"],
        "response_types_supported": ["code"],
        "scopes_supported": [OPENID_SCOPE, PROFILE_SCOPE, EMAIL_SCOPE, OFFLINE_ACCESS_SCOPE],
        "issuer": issuer(&tenant),
        "request_uri_parameter_supported": false,
        "userinfo_endpoint": format!("{base}/oidc/userinfo"),
        "authorization_endpoint": format!("{browser}/{tenant}/oauth2/v2.0/authorize"),
        "claims_supported": [
            "sub", "iss", "aud", "exp", "iat", "nbf", "name", "preferred_username", "oid",
            "tid", "email", "nonce", "ver", "xms_edov",
        ],
        "tenant_region_scope": null,
        "cloud_instance_name": "microsoftonline.com",
    });
    logged(
        Json(document).into_response(),
        Some(Route::OauthDiscovery),
        None,
    )
}

/// `GET /{tenant}/discovery/v2.0/keys`: the key ID tokens are signed with.
async fn keys(AxumState(emulator): Emulator, Path(tenant): Path<String>) -> Response {
    let answered = match emulator.signing_key().await {
        Ok(key) => Json(key.key_set(&issuer(&tenant))).into_response(),
        Err(error) => {
            tracing::error!(error = ?error, "no ID token signing key");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    };
    logged(answered, Some(Route::OauthKeys), None)
}

/// A user's Microsoft subject: 43 characters, the same for the same address
/// in every emulator, so an identity linked to it survives a restart.
fn subject(email: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(email.as_bytes()))
}

/// What `/oidc/userinfo` says about a user.
#[derive(Serialize)]
struct UserInfo<'a> {
    sub: String,
    name: &'a str,
    given_name: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    family_name: Option<&'a str>,
    email: &'a str,
}

fn user_info(mailbox: &Mailbox) -> UserInfo<'_> {
    let name = mailbox.name.trim();
    let (given_name, family_name) = match name.split_once(' ') {
        Some((given, family)) => (given, Some(family)),
        None => (name, None),
    };
    UserInfo {
        sub: subject(&mailbox.email),
        name,
        given_name,
        family_name,
        email: &mailbox.email,
    }
}

/// `GET /oidc/userinfo`: the user an access token belongs to.
async fn userinfo(AxumState(emulator): Emulator, headers: HeaderMap) -> Response {
    let (mailbox, answered) = emulator.with_state(|state| {
        let owner = match bearer(&headers) {
            Some(token) => state.token_owner(token),
            None => Err(crate::error::GraphError::unauthenticated(
                "Access token is empty.",
            )),
        };
        match owner {
            Ok(email) => {
                let answered = match state.mailboxes.get(&email) {
                    Some(mailbox) => Json(user_info(mailbox)).into_response(),
                    None => StatusCode::UNAUTHORIZED.into_response(),
                };
                (Some(email), answered)
            }
            Err(error) => (None, response(Err(error), state.now())),
        }
    });
    logged(answered, Some(Route::OauthUserInfo), mailbox)
}

#[derive(Serialize)]
struct IdTokenClaims<'a> {
    aud: &'a str,
    iss: String,
    iat: i64,
    nbf: i64,
    exp: i64,
    sub: String,
    tid: &'a str,
    oid: &'a str,
    ver: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    name: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    preferred_username: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<&'a str>,
    /// Microsoft verified that the account's organization owns the email
    /// address's domain. Absent when it has not.
    #[serde(skip_serializing_if = "Option::is_none")]
    xms_edov: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    nonce: Option<&'a str>,
}

/// Whether a consent's scopes yield an ID token.
pub(crate) fn grants_id_token(scopes: &[String]) -> bool {
    scopes.iter().any(|scope| scope == OPENID_SCOPE)
}

/// Signs the ID token of a token response. It carries Microsoft's issuer
/// for the user's tenant and is dated by the real clock, the one its
/// verifier reads.
pub(crate) fn id_token(
    key: &SigningKey,
    mailbox: &Mailbox,
    consent: &Consent,
) -> Result<String, jsonwebtoken::errors::Error> {
    let issued_at = Utc::now().timestamp();
    let asked = |scope: &str| consent.scopes.iter().any(|asked| asked == scope);
    let profile = asked(PROFILE_SCOPE);
    let email = asked(EMAIL_SCOPE);

    key.sign(&IdTokenClaims {
        aud: &consent.client_id,
        iss: issuer(&mailbox.tenant_id),
        iat: issued_at,
        nbf: issued_at,
        exp: issued_at + ID_TOKEN_LIFETIME_SECONDS,
        sub: subject(&mailbox.email),
        tid: &mailbox.tenant_id,
        oid: &mailbox.user_id,
        ver: "2.0",
        name: profile.then_some(mailbox.name.as_str()),
        preferred_username: profile.then_some(mailbox.email.as_str()),
        email: email.then_some(mailbox.email.as_str()),
        xms_edov: (email && mailbox.email_domain_verified).then_some(true),
        nonce: consent.nonce.as_deref(),
    })
}
