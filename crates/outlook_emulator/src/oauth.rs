//! Access tokens: Microsoft's OAuth token endpoint, and a stand-in for the
//! route of Macro's authentication service that the email service gets its
//! Microsoft access tokens from.

use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::OutlookEmulator;
use crate::fault::Route;
use crate::graph::{logged, response};
use crate::mailbox::SEEDED_SCOPES as SCOPES;
use crate::render;
use crate::sign_in::{OFFLINE_ACCESS_SCOPE, grants_id_token, id_token};
use crate::signing_key::SigningKey;
use crate::state::{CodeError, State};

#[derive(Deserialize)]
struct TokenRequest {
    grant_type: String,
    refresh_token: Option<String>,
    code: Option<String>,
    redirect_uri: Option<String>,
    code_verifier: Option<String>,
    /// Absent when the client authenticates with a Basic header instead.
    client_id: Option<String>,
}

/// The client id of a Basic `Authorization` header.
fn basic_client_id(headers: &HeaderMap) -> Option<String> {
    let encoded = headers
        .get(header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Basic ")?;
    let decoded = String::from_utf8(STANDARD.decode(encoded).ok()?).ok()?;
    let (client_id, _secret) = decoded.split_once(':')?;
    Some(client_id.to_string())
}

/// Azure AD's error body for a refused token request.
fn refused(state: &State, error: &str, code: u32, description: &str) -> Response {
    let body = json!({
        "error": error,
        "error_description": format!("AADSTS{code}: {description}"),
        "error_codes": [code],
        "timestamp": render::time(state.now()),
        "trace_id": uuid::Uuid::now_v7(),
        "correlation_id": uuid::Uuid::now_v7(),
    });
    (StatusCode::BAD_REQUEST, Json(body)).into_response()
}

/// An injected fault for a token request, as a response.
fn fault(state: &mut State, mailbox: Option<&str>) -> Option<Response> {
    let fault = state.take_fault(mailbox, Route::OauthToken)?;
    let error = fault.error?.graph_error(fault.retry_after_seconds);
    Some(response(Err(error), state.now()))
}

/// The body of a granted token request.
fn granted(
    access_token: &str,
    scopes: &[String],
    refresh_token: Option<&str>,
    id_token: Option<&str>,
) -> Response {
    let mut body = json!({
        "token_type": "Bearer",
        "scope": scopes.join(" "),
        "expires_in": State::access_token_lifetime_seconds(),
        "ext_expires_in": State::access_token_lifetime_seconds(),
        "access_token": access_token,
    });
    if let Some(refresh_token) = refresh_token {
        body["refresh_token"] = json!(refresh_token);
    }
    if let Some(id_token) = id_token {
        body["id_token"] = json!(id_token);
    }
    Json(body).into_response()
}

/// The refresh token grant: a new access token, and a further refresh
/// token, until the grant is revoked.
fn refresh(state: &mut State, request: &TokenRequest) -> (Option<String>, Response) {
    let owner = request
        .refresh_token
        .as_deref()
        .and_then(|token| state.refresh_token_owner(token))
        .map(|mailbox| {
            (
                mailbox.email.clone(),
                mailbox.revoked,
                mailbox.scopes.clone(),
            )
        });
    let Some((email, revoked, scopes)) = owner else {
        let answered = refused(
            state,
            "invalid_grant",
            70000,
            "The provided value for the input parameter 'refresh_token' is not valid.",
        );
        return (None, answered);
    };
    if let Some(answered) = fault(state, Some(&email)) {
        return (Some(email), answered);
    }
    let issued = match revoked {
        true => None,
        false => state.issue_access_token(&email).ok(),
    };
    let answered = match issued {
        None => refused(
            state,
            "invalid_grant",
            50173,
            "The provided grant has expired due to it being revoked, a fresh auth token is needed.",
        ),
        Some(access_token) => {
            let refresh_token = state.rotate_refresh_token(&email);
            granted(&access_token, &scopes, Some(&refresh_token), None)
        }
    };
    (Some(email), answered)
}

/// The authorization code grant: the tokens of the consent the code stands
/// for.
fn exchange(
    state: &mut State,
    request: &TokenRequest,
    client_id: Option<&str>,
    key: &SigningKey,
) -> (Option<String>, Response) {
    let (Some(code), Some(client_id), Some(redirect_uri)) =
        (&request.code, client_id, &request.redirect_uri)
    else {
        let answered = refused(
            state,
            "invalid_request",
            900144,
            "The request body must contain the following parameters: 'code', 'client_id', 'redirect_uri'.",
        );
        return (None, answered);
    };
    let challenge = request
        .code_verifier
        .as_deref()
        .map(|verifier| URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes())));

    let redeemed = match state.redeem_code(code, client_id, redirect_uri, challenge.as_deref()) {
        Ok(redeemed) => redeemed,
        Err(error) => {
            let (code, description) = match error {
                CodeError::Unknown => (
                    70000,
                    "The provided authorization code is not valid or was already redeemed.",
                ),
                CodeError::Expired => (70008, "The provided authorization code has expired."),
                CodeError::Client => (
                    700005,
                    "The provided authorization code was issued to another client.",
                ),
                CodeError::RedirectUri => (
                    500112,
                    "The reply address does not match the reply address provided when requesting the authorization code.",
                ),
                CodeError::Verifier => (
                    501481,
                    "The code_verifier does not match the code_challenge supplied in the authorization request.",
                ),
            };
            return (None, refused(state, "invalid_grant", code, description));
        }
    };
    let email = redeemed.email;
    if let Some(answered) = fault(state, Some(&email)) {
        return (Some(email), answered);
    }

    let scopes = &redeemed.consent.scopes;
    let signed = match (grants_id_token(scopes), state.mailboxes.get(&email)) {
        (true, Some(mailbox)) => id_token(key, mailbox, &redeemed.consent).map(Some),
        _ => Ok(None),
    };
    let answered = match (signed, state.issue_access_token(&email)) {
        (Ok(id_token), Ok(access_token)) => {
            let refresh_token = scopes
                .iter()
                .any(|scope| scope == OFFLINE_ACCESS_SCOPE)
                .then(|| state.rotate_refresh_token(&email));
            // Like Microsoft, the response names the permissions granted,
            // not the request to stay signed in.
            let named: Vec<String> = scopes
                .iter()
                .filter(|scope| *scope != OFFLINE_ACCESS_SCOPE)
                .cloned()
                .collect();
            granted(
                &access_token,
                &named,
                refresh_token.as_deref(),
                id_token.as_deref(),
            )
        }
        (Err(error), _) => {
            tracing::error!(error = ?error, "ID token could not be signed");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
        (_, Err(_)) => refused(
            state,
            "invalid_grant",
            50173,
            "The provided grant has expired due to it being revoked, a fresh auth token is needed.",
        ),
    };
    (Some(email), answered)
}

/// `POST /{tenant}/oauth2/v2.0/token`: the authorization code and refresh
/// token grants. Any client id and secret are accepted, in the form or as a
/// Basic header.
async fn token(
    AxumState(emulator): AxumState<OutlookEmulator>,
    headers: HeaderMap,
    Form(request): Form<TokenRequest>,
) -> Response {
    let key = match emulator.signing_key().await {
        Ok(key) => key,
        Err(error) => {
            tracing::error!(error = ?error, "no ID token signing key");
            let unavailable = StatusCode::INTERNAL_SERVER_ERROR.into_response();
            return logged(unavailable, Some(Route::OauthToken), None);
        }
    };
    let client_id = request
        .client_id
        .clone()
        .or_else(|| basic_client_id(&headers));

    let (mailbox, answered) = emulator.with_state(|state| match request.grant_type.as_str() {
        "refresh_token" => refresh(state, &request),
        "authorization_code" => exchange(state, &request, client_id.as_deref(), key),
        _ => {
            let answered = refused(
                state,
                "unsupported_grant_type",
                70003,
                "The emulator supports only the authorization_code and refresh_token grants.",
            );
            (None, answered)
        }
    });
    logged(answered, Some(Route::OauthToken), mailbox)
}

#[derive(Deserialize)]
struct LinkTokenRequest {
    link_id: String,
    #[serde(default)]
    force_refresh: bool,
}

/// Stands in for the authentication service's
/// `GET /internal/microsoft_access_token`, which in production refreshes the
/// link's grant with Microsoft. It answers what that route answers: the
/// access token with its scopes and whether it came from the cache, 404 for
/// a link it does not know, and 401 for a grant Microsoft no longer honours.
/// Faults on `oauth.token` apply.
async fn link_token(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Query(request): Query<LinkTokenRequest>,
) -> Response {
    let (mailbox, mut answered) = emulator.with_state(|state| {
        let Some(email) = state.links.get(&request.link_id.to_lowercase()).cloned() else {
            return (None, StatusCode::NOT_FOUND.into_response());
        };
        if let Some(answered) = fault(state, Some(&email)) {
            return (Some(email), answered);
        }
        let answered = match state.link_access_token(&request.link_id, request.force_refresh) {
            Ok((access_token, cached)) => Json(json!({
                "access_token": access_token,
                "scopes": SCOPES,
                "cached": cached,
            }))
            .into_response(),
            Err(_) => StatusCode::UNAUTHORIZED.into_response(),
        };
        (Some(email), answered)
    });
    answered
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    logged(answered, Some(Route::OauthToken), mailbox)
}

#[derive(Deserialize)]
struct GrantRequest {
    attempt_id: String,
    owner: String,
}

/// The id the stand-in gives the grant one principal holds for a mailbox.
/// Like the authentication service, each principal who signs in to a mailbox
/// holds a grant of their own.
fn grant_id(owner: &str, email: &str) -> uuid::Uuid {
    uuid::Uuid::new_v5(
        &uuid::Uuid::NAMESPACE_URL,
        format!("{owner}\n{email}").as_bytes(),
    )
}

/// Stands in for the authentication service's `GET /internal/microsoft_grant`,
/// which describes the grant a finished OAuth attempt produced. The attempt
/// is one bound to a mailbox with `link_mailbox`; the owner is whoever asks.
async fn completed_grant(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Query(request): Query<GrantRequest>,
) -> Response {
    let (mailbox, answered) = emulator.with_state(|state| {
        let email = state.links.get(&request.attempt_id.to_lowercase());
        let Some(mailbox) = email.and_then(|email| state.mailboxes.get(email)) else {
            return (None, StatusCode::NOT_FOUND.into_response());
        };
        let id = grant_id(&request.owner, &mailbox.email);
        state.grants.insert(id, mailbox.email.clone());
        state
            .link_grants
            .entry(request.attempt_id.to_lowercase())
            .or_default()
            .insert(id);
        let grant = json!({
            "calendar_requested": false,
            "grant_id": id,
            "generation": 1,
            "owner": request.owner,
            "email": mailbox.email,
            "tenant_id": mailbox.tenant_id,
            "mailbox_id": mailbox.user_id,
            "scopes": SCOPES,
        });
        (Some(mailbox.email.clone()), Json(grant).into_response())
    });
    logged(answered, Some(Route::OauthToken), mailbox)
}

#[derive(Deserialize)]
struct RevokeRequest {
    grant_id: uuid::Uuid,
}

/// Stands in for `POST /internal/revoke_microsoft_grant`: the grant it names
/// is released, and the grants other principals hold for the same mailbox
/// stay. A link described with only released grants gets no more access
/// tokens, and the mailbox is revoked once no grant for it is left.
async fn revoke_grant(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Json(request): Json<RevokeRequest>,
) -> Response {
    let mailbox = emulator.with_state(|state| {
        let email = state.grants.remove(&request.grant_id)?;
        if !state.grants.values().any(|held| *held == email) {
            state.revoke_grant(&email).ok()?;
        }
        Some(email)
    });
    logged(
        StatusCode::NO_CONTENT.into_response(),
        Some(Route::OauthToken),
        mailbox,
    )
}

pub(crate) fn router() -> Router<OutlookEmulator> {
    let authentication_service = "/_emulator/authentication-service/internal";
    Router::new()
        .route("/{tenant}/oauth2/v2.0/token", post(token))
        .route(
            &format!("{authentication_service}/microsoft_access_token"),
            get(link_token),
        )
        .route(
            &format!("{authentication_service}/microsoft_disconnect_token"),
            get(link_token),
        )
        .route(
            &format!("{authentication_service}/microsoft_grant"),
            get(completed_grant),
        )
        .route(
            &format!("{authentication_service}/revoke_microsoft_grant"),
            post(revoke_grant),
        )
}
