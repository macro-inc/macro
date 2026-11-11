//! Access tokens: Microsoft's OAuth token endpoint, and a stand-in for the
//! route of Macro's authentication service that the email service gets its
//! Microsoft access tokens from.

use axum::extract::{Query, State as AxumState};
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use serde::Deserialize;
use serde_json::json;

use crate::OutlookEmulator;
use crate::fault::Route;
use crate::graph::{logged, response};
use crate::render;
use crate::state::State;

const SCOPES: [&str; 6] = [
    "User.Read",
    "Mail.ReadWrite",
    "Mail.Send",
    "MailboxSettings.ReadWrite",
    "Contacts.Read",
    "offline_access",
];

#[derive(Deserialize)]
struct TokenRequest {
    grant_type: String,
    refresh_token: Option<String>,
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

/// `POST /{tenant}/oauth2/v2.0/token` with a refresh token grant.
async fn token(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Form(request): Form<TokenRequest>,
) -> Response {
    let (mailbox, answered) = emulator.with_state(|state| {
        if request.grant_type != "refresh_token" {
            let answered = refused(
                state,
                "unsupported_grant_type",
                70003,
                "The emulator supports only the refresh_token grant.",
            );
            return (None, answered);
        }
        let owner = request
            .refresh_token
            .as_deref()
            .and_then(|token| state.refresh_token_owner(token))
            .map(|mailbox| (mailbox.email.clone(), mailbox.revoked, mailbox.refresh_token.clone()));
        let Some((email, revoked, refresh_token)) = owner else {
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
            Some(access_token) => Json(json!({
                "token_type": "Bearer",
                "scope": SCOPES.join(" "),
                "expires_in": State::access_token_lifetime_seconds(),
                "ext_expires_in": State::access_token_lifetime_seconds(),
                "access_token": access_token,
                "refresh_token": refresh_token,
            }))
            .into_response(),
        };
        (Some(email), answered)
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

/// The id the stand-in gives a mailbox's grant.
fn grant_id(email: &str) -> uuid::Uuid {
    uuid::Uuid::new_v5(&uuid::Uuid::NAMESPACE_URL, email.as_bytes())
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
        let grant = json!({
            "calendar_requested": false,
            "grant_id": grant_id(&mailbox.email),
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

/// Stands in for `POST /internal/revoke_microsoft_grant`: the mailbox whose
/// grant it names is revoked.
async fn revoke_grant(
    AxumState(emulator): AxumState<OutlookEmulator>,
    Json(request): Json<RevokeRequest>,
) -> Response {
    let mailbox = emulator.with_state(|state| {
        let email = state
            .mailboxes
            .keys()
            .find(|email| grant_id(email) == request.grant_id)
            .cloned()?;
        state.revoke_grant(&email).ok()?;
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
