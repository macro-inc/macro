//! The other Google endpoints Macro's email code calls: the People API,
//! the OAuth token endpoint (code exchange and refresh), token info and
//! revocation, and the certificates that verify push and ID tokens.

use std::collections::HashMap;

use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use serde_json::{Value, json};

use crate::GmailEmulator;
use crate::error::ApiError;
use crate::fault::Route;
use crate::gate::{Params, mailbox_request, open_request};
use crate::gmail_routes::mailbox;
use crate::mailbox::Mailbox;
use crate::people::{PeoplePage, person_json};
use crate::push::SigningKey;
use crate::seed::SeedContact;
use crate::sign_in::{grants_id_token, id_token};
use crate::state::{ACCESS_TOKEN_LIFETIME_SECONDS, CodeRefusal, State};

const CONTACTS_SCOPE: &str = "https://www.googleapis.com/auth/contacts.readonly";
const OTHER_CONTACTS_SCOPE: &str = "https://www.googleapis.com/auth/contacts.other.readonly";
const PEOPLE_PAGE_DEFAULT: usize = 100;
const PEOPLE_PAGE_MAX: usize = 1000;
/// How long a client may cache the certificates, like Google's header.
const CERTS_CACHE_CONTROL: &str = "public, max-age=3600, must-revalidate, no-transform";

type Emulator = AxumState<GmailEmulator>;
type Listed = Query<Vec<(String, String)>>;

pub(crate) fn router() -> Router<GmailEmulator> {
    Router::new()
        .route("/people/v1/people/me", get(me))
        .route("/people/v1/people/me/connections", get(connections))
        .route("/people/v1/otherContacts", get(other_contacts))
        .route("/token", post(token))
        .route("/revoke", post(revoke))
        .route("/oauth2/v3/tokeninfo", get(token_info).post(token_info))
        .route("/oauth2/v3/certs", get(certs))
}

async fn me(AxumState(emulator): Emulator, headers: HeaderMap) -> Response {
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::PeopleGet,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            let contact = SeedContact {
                email: mailbox.email.clone(),
                name: mailbox.name.clone(),
                photo_url: None,
            };
            Ok(Json(person_json("people/me", &contact, false)))
        },
    )
    .await
}

fn scope_required(scope: &str) -> ApiError {
    ApiError::permission_denied(&format!(
        "Request had insufficient authentication scopes. Missing scope: {scope}"
    ))
}

async fn connections(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::ConnectionsList,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            if !mailbox.has_scope(CONTACTS_SCOPE) {
                return Err(scope_required(CONTACTS_SCOPE));
            }

            let page = mailbox.contacts.list(
                params.get("syncToken"),
                params.flag("requestSyncToken"),
                params.page_size("pageSize", PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX),
                params.offset()?,
            )?;
            Ok(Json(people_page("connections", page)))
        },
    )
    .await
}

async fn other_contacts(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(
        &emulator,
        &headers,
        None,
        Route::OtherContactsList,
        |state, email| {
            let mailbox = mailbox(state, email)?;
            if !mailbox.has_scope(OTHER_CONTACTS_SCOPE) {
                return Err(scope_required(OTHER_CONTACTS_SCOPE));
            }

            let page = mailbox.other_contacts.list(
                params.get("syncToken"),
                params.flag("requestSyncToken"),
                params.page_size("pageSize", PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX),
                params.offset()?,
            )?;
            Ok(Json(people_page("otherContacts", page)))
        },
    )
    .await
}

fn people_page(key: &str, page: PeoplePage) -> Value {
    let mut response = json!({});
    if !page.people.is_empty() {
        response[key] = Value::Array(page.people);
    }
    if let Some(token) = page.next_page_token {
        response["nextPageToken"] = json!(token);
    }
    if let Some(token) = page.next_sync_token {
        response["nextSyncToken"] = json!(token);
    }
    response
}

fn oauth_error(error: &str, description: &str) -> Response {
    (
        StatusCode::BAD_REQUEST,
        Json(json!({ "error": error, "error_description": description })),
    )
        .into_response()
}

/// The client id on tokens whose request names no client.
const DEFAULT_CLIENT_ID: &str = "gmail-emulator.apps.googleusercontent.com";

fn token_response(
    key: &SigningKey,
    mailbox: &Mailbox,
    client_id: &str,
    access_token: &str,
    refresh_token: Option<&str>,
    scopes: &[String],
    nonce: Option<&str>,
) -> Response {
    let mut response = json!({
        "access_token": access_token,
        "expires_in": ACCESS_TOKEN_LIFETIME_SECONDS,
        "scope": scopes.join(" "),
        "token_type": "Bearer",
    });
    if let Some(refresh_token) = refresh_token {
        response["refresh_token"] = json!(refresh_token);
    }
    if grants_id_token(scopes) {
        match id_token(key, mailbox, client_id, nonce) {
            Ok(id_token) => response["id_token"] = json!(id_token),
            Err(error) => {
                tracing::error!(error = ?error, "ID token could not be signed");
                return StatusCode::INTERNAL_SERVER_ERROR.into_response();
            }
        }
    }
    Json(response).into_response()
}

/// Refreshes a mailbox's access token. Returns the mailbox the refresh
/// token belongs to, and Google's answer.
fn refresh(
    state: &mut State,
    key: &SigningKey,
    client_id: &str,
    refresh_token: &str,
) -> (Option<String>, Response) {
    let Some(email) = state
        .mailbox_for_refresh_token(refresh_token)
        .map(|mailbox| mailbox.email.clone())
    else {
        let owner = state
            .mailboxes
            .values()
            .find(|mailbox| mailbox.refresh_token == refresh_token)
            .map(|mailbox| mailbox.email.clone());
        return (
            owner,
            oauth_error("invalid_grant", "Token has been expired or revoked."),
        );
    };

    let response = match (
        state.issue_access_token(&email),
        state.mailboxes.get(&email),
    ) {
        (Ok(access_token), Some(mailbox)) => token_response(
            key,
            mailbox,
            client_id,
            &access_token,
            None,
            &mailbox.scopes,
            None,
        ),
        _ => oauth_error("invalid_grant", "Token has been expired or revoked."),
    };
    (Some(email), response)
}

/// Exchanges the sign-in page's authorization code for tokens.
fn exchange(
    state: &mut State,
    key: &SigningKey,
    client_id: &str,
    code: &str,
    redirect_uri: &str,
) -> (Option<String>, Response) {
    let exchanged = match state.exchange_code(code, client_id, redirect_uri) {
        Ok(exchanged) => exchanged,
        Err(CodeRefusal::Invalid) => return (None, oauth_error("invalid_grant", "Bad Request")),
        Err(CodeRefusal::WrongClient) => {
            return (None, oauth_error("invalid_client", "Unauthorized"));
        }
        Err(CodeRefusal::RedirectMismatch) => {
            return (None, oauth_error("redirect_uri_mismatch", "Bad Request"));
        }
    };

    let response = match state.mailboxes.get(&exchanged.email) {
        Some(mailbox) => token_response(
            key,
            mailbox,
            client_id,
            &exchanged.access_token,
            exchanged.refresh_token.as_deref(),
            &exchanged.scopes,
            exchanged.nonce.as_deref(),
        ),
        None => oauth_error("invalid_grant", "Bad Request"),
    };
    (Some(exchanged.email), response)
}

/// The parameters of a token request. Google reads a form body, and a JSON
/// object as well; a client may name itself in a Basic `Authorization`
/// header instead of the body.
fn token_request(headers: &HeaderMap, body: &str) -> HashMap<String, String> {
    let is_json = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("application/json"));
    let mut request: HashMap<String, String> = match is_json {
        true => serde_json::from_str(body).unwrap_or_default(),
        false => serde_urlencoded::from_str(body).unwrap_or_default(),
    };

    let basic_client_id = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Basic "))
        .and_then(|encoded| STANDARD.decode(encoded).ok())
        .and_then(|decoded| String::from_utf8(decoded).ok())
        .and_then(|pair| pair.split_once(':').map(|(id, _)| id.to_string()));
    if let Some(client_id) = basic_client_id {
        request.entry("client_id".to_string()).or_insert(client_id);
    }
    request
}

async fn token(AxumState(emulator): Emulator, headers: HeaderMap, body: String) -> Response {
    let request = token_request(&headers, &body);
    let parameter = |name: &str| request.get(name).map(String::as_str);
    let key = match emulator.signing_key().await {
        Ok(key) => key,
        Err(error) => {
            tracing::error!(error = ?error, "signing key is unavailable");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let client_id = parameter("client_id").unwrap_or(DEFAULT_CLIENT_ID);
    let missing = |name: &str| {
        (
            None,
            oauth_error(
                "invalid_request",
                &format!("Missing required parameter: {name}"),
            ),
        )
    };

    open_request(&emulator, Route::OauthToken, |state| {
        match parameter("grant_type") {
            Some("refresh_token") => match parameter("refresh_token") {
                Some(refresh_token) => refresh(state, key, client_id, refresh_token),
                None => missing("refresh_token"),
            },
            Some("authorization_code") => {
                match (parameter("code"), parameter("redirect_uri")) {
                    (Some(code), Some(redirect_uri)) => {
                        exchange(state, key, client_id, code, redirect_uri)
                    }
                    (None, _) => missing("code"),
                    (_, None) => missing("redirect_uri"),
                }
            }
            _ => (
                None,
                oauth_error(
                    "unsupported_grant_type",
                    "The emulator serves grant_type=authorization_code and grant_type=refresh_token.",
                ),
            ),
        }
    })
    .await
}

/// A parameter Google accepts in the query or in a form body.
fn parameter(query: &HashMap<String, String>, body: &str, name: &str) -> String {
    let form: HashMap<String, String> = serde_urlencoded::from_str(body).unwrap_or_default();
    query
        .get(name)
        .or_else(|| form.get(name))
        .cloned()
        .unwrap_or_default()
}

async fn revoke(
    AxumState(emulator): Emulator,
    Query(query): Query<HashMap<String, String>>,
    body: String,
) -> Response {
    let token = parameter(&query, &body, "token");

    match emulator.with_state(|state| state.revoke_token(&token)) {
        true => Json(json!({})).into_response(),
        false => oauth_error("invalid_token", "Token expired or revoked"),
    }
}

async fn token_info(
    AxumState(emulator): Emulator,
    Query(query): Query<HashMap<String, String>>,
    body: String,
) -> Response {
    let token = parameter(&query, &body, "access_token");

    open_request(&emulator, Route::OauthTokenInfo, |state| {
        let now_ms = state.now_ms();
        let Some((mailbox, expires_at_ms)) = state.token_owner(&token) else {
            return (None, oauth_error("invalid_token", "Invalid Value"));
        };

        let info = json!({
            "azp": DEFAULT_CLIENT_ID,
            "aud": DEFAULT_CLIENT_ID,
            "scope": mailbox.scopes.join(" "),
            "exp": (expires_at_ms / 1000).to_string(),
            "expires_in": ((expires_at_ms - now_ms) / 1000).to_string(),
            "email": mailbox.email,
            "email_verified": "true",
            "access_type": "offline",
        });
        (Some(mailbox.email.clone()), Json(info).into_response())
    })
    .await
}

async fn certs(AxumState(emulator): Emulator) -> Response {
    let key = match emulator.signing_key().await {
        Ok(key) => key,
        Err(error) => {
            tracing::error!(error = ?error, "signing key is unavailable");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    (
        [
            (
                header::CONTENT_TYPE,
                HeaderValue::from_static("application/json"),
            ),
            (
                header::CACHE_CONTROL,
                HeaderValue::from_static(CERTS_CACHE_CONTROL),
            ),
        ],
        key.jwks.clone(),
    )
        .into_response()
}
