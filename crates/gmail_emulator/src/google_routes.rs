//! The other Google endpoints Macro's email code calls: the People API,
//! OAuth token refresh, token info and revocation, and the certificates
//! that verify push tokens.

use std::collections::HashMap;

use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use serde_json::{Value, json};

use crate::GmailEmulator;
use crate::error::ApiError;
use crate::fault::Route;
use crate::gate::{Params, mailbox_request, open_request};
use crate::gmail_routes::mailbox;
use crate::people::person_json;
use crate::seed::SeedContact;
use crate::state::{ACCESS_TOKEN_LIFETIME_SECONDS, State};

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
    mailbox_request(&emulator, &headers, None, Route::PeopleGet, |state, email| {
        let mailbox = mailbox(state, email)?;
        let contact = SeedContact {
            email: mailbox.email.clone(),
            name: mailbox.name.clone(),
            photo_url: None,
        };
        Ok(Json(person_json("people/me", &contact, false)))
    })
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
    mailbox_request(&emulator, &headers, None, Route::ConnectionsList, |state, email| {
        let mailbox = mailbox(state, email)?;
        if !mailbox.has_scope(CONTACTS_SCOPE) {
            return Err(scope_required(CONTACTS_SCOPE));
        }

        let (people, next_page, next_sync) = mailbox.contacts.list(
            params.get("syncToken"),
            params.flag("requestSyncToken"),
            params.page_size("pageSize", PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX),
            params.offset()?,
        )?;
        Ok(Json(people_page("connections", people, next_page, next_sync)))
    })
    .await
}

async fn other_contacts(
    AxumState(emulator): Emulator,
    headers: HeaderMap,
    Query(params): Listed,
) -> Response {
    let params = Params(params);
    mailbox_request(&emulator, &headers, None, Route::OtherContactsList, |state, email| {
        let mailbox = mailbox(state, email)?;
        if !mailbox.has_scope(OTHER_CONTACTS_SCOPE) {
            return Err(scope_required(OTHER_CONTACTS_SCOPE));
        }

        let (people, next_page, next_sync) = mailbox.other_contacts.list(
            params.get("syncToken"),
            params.flag("requestSyncToken"),
            params.page_size("pageSize", PEOPLE_PAGE_DEFAULT, PEOPLE_PAGE_MAX),
            params.offset()?,
        )?;
        Ok(Json(people_page("otherContacts", people, next_page, next_sync)))
    })
    .await
}

fn people_page(
    key: &str,
    people: Vec<Value>,
    next_page: Option<String>,
    next_sync: Option<String>,
) -> Value {
    let mut response = json!({});
    if !people.is_empty() {
        response[key] = Value::Array(people);
    }
    if let Some(token) = next_page {
        response["nextPageToken"] = json!(token);
    }
    if let Some(token) = next_sync {
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

/// Refreshes a mailbox's access token. Returns the mailbox the refresh
/// token belongs to, and Google's answer.
pub(crate) fn refresh(state: &mut State, refresh_token: &str) -> (Option<String>, Response) {
    let Some(mailbox) = state.mailbox_for_refresh_token(refresh_token) else {
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

    let (email, scope) = (mailbox.email.clone(), mailbox.scopes.join(" "));
    let response = match state.issue_access_token(&email) {
        Ok(access_token) => Json(json!({
            "access_token": access_token,
            "expires_in": ACCESS_TOKEN_LIFETIME_SECONDS,
            "scope": scope,
            "token_type": "Bearer",
        }))
        .into_response(),
        Err(_) => oauth_error("invalid_grant", "Token has been expired or revoked."),
    };
    (Some(email), response)
}

async fn token(
    AxumState(emulator): Emulator,
    Form(form): Form<HashMap<String, String>>,
) -> Response {
    open_request(&emulator, Route::OauthToken, |state| {
        if form.get("grant_type").map(String::as_str) != Some("refresh_token") {
            return (
                None,
                oauth_error(
                    "unsupported_grant_type",
                    "The emulator only refreshes tokens: grant_type=refresh_token.",
                ),
            );
        }
        match form.get("refresh_token") {
            Some(refresh_token) => refresh(state, refresh_token),
            None => (
                None,
                oauth_error("invalid_request", "Missing required parameter: refresh_token"),
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
            "azp": "gmail-emulator.apps.googleusercontent.com",
            "aud": "gmail-emulator.apps.googleusercontent.com",
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
            tracing::error!(error = ?error, "push signing key is unavailable");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    (
        [
            (header::CONTENT_TYPE, HeaderValue::from_static("application/json")),
            (header::CACHE_CONTROL, HeaderValue::from_static(CERTS_CACHE_CONTROL)),
        ],
        key.jwks.clone(),
    )
        .into_response()
}
