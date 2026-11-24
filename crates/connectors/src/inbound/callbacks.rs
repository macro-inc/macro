//! The public routes vendors and authorization servers call: the OAuth
//! callback and client metadata document for servers signed in to by URL,
//! the OAuth callback for REST apps Macro signs in to itself (Autodesk),
//! Macro Connect's consent page, and Pipedream's webhook.
//!
//! Their paths are registered with third parties, so they never change.
//! None is authenticated as a user: the OAuth callback trusts only its
//! one-time state, the consent page records nothing, and the webhook checks
//! a shared secret.

use crate::domain::sign_in::ServerSignInService;
use crate::inbound::{ConnectorHook, fire};
use axum::{
    Json, Router,
    extract::{Query, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
};
use model_error_response::ErrorResponse;
use serde::Deserialize;
use std::sync::Arc;
use utoipa::IntoParams;

#[cfg(test)]
mod test;

/// The OAuth callback route's path, registered as the redirect URI.
pub const OAUTH_CALLBACK_PATH: &str = "/mcp/servers/auth/callback";
/// The OAuth callback route's path for REST apps Macro signs in to with its
/// own registered client (Autodesk): the redirect URI registered with each.
pub const APP_OAUTH_CALLBACK_PATH: &str = "/connectors/apps/auth/callback";
/// The client metadata document's path, Macro's OAuth client id.
pub const CLIENT_METADATA_PATH: &str = "/mcp/servers/auth/client-metadata";
/// The page Macro Connect sends the browser to after consent.
pub const CONSENT_CALLBACK_PATH: &str = "/pipedream/mcp/connect/callback";
/// Where Pipedream posts connect-flow outcomes.
pub const WEBHOOK_PATH: &str = "/pipedream/mcp/webhook";

/// What the callback routes run on.
pub struct CallbacksState<G> {
    sign_ins: Arc<G>,
    on_connected: Option<ConnectorHook>,
}

impl<G> Clone for CallbacksState<G> {
    fn clone(&self) -> Self {
        Self {
            sign_ins: self.sign_ins.clone(),
            on_connected: self.on_connected.clone(),
        }
    }
}

impl<G: ServerSignInService> CallbacksState<G> {
    /// The callbacks over the server sign-ins.
    pub fn new(sign_ins: G) -> Self {
        Self {
            sign_ins: Arc::new(sign_ins),
            on_connected: None,
        }
    }

    /// Run `hook` for what each finished sign-in connected.
    pub fn with_connected_hook(mut self, hook: ConnectorHook) -> Self {
        self.on_connected = Some(hook);
        self
    }
}

/// The OAuth callback, the client metadata document and the Connect consent
/// page. Mount outside authentication.
pub fn callbacks_router<G, Global>(state: CallbacksState<G>) -> Router<Global>
where
    G: ServerSignInService,
    Global: Send + Sync,
{
    Router::new()
        .route(OAUTH_CALLBACK_PATH, get(oauth_callback::<G>))
        .route(APP_OAUTH_CALLBACK_PATH, get(app_oauth_callback::<G>))
        .route(CLIENT_METADATA_PATH, get(client_metadata::<G>))
        .route(CONSENT_CALLBACK_PATH, get(consent_callback))
        .with_state(state)
}

/// Pipedream's webhook. Mount outside authentication, and only when the
/// shared secret in the configured webhook URI is set.
///
/// Pipedream posts connect-flow outcomes here, including the failures inside
/// its hosted dialog that never reach an authenticated route of ours.
pub fn pipedream_webhook_router<Global>(secret: String) -> Router<Global>
where
    Global: Send + Sync,
{
    Router::new()
        .route(WEBHOOK_PATH, post(pipedream_webhook))
        .with_state(WebhookState {
            secret: Arc::from(secret),
        })
}

/// Query parameters on the OAuth callback redirect.
///
/// Providers redirect here on success (`code` and `state`) and on failure
/// (`error`, maybe `error_description`; RFC 6749 §4.1.2.1). Every field is
/// optional so a refusal is still read and logged.
#[derive(Debug, Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct OAuthCallbackParams {
    /// The authorization code, on success.
    code: Option<String>,
    /// The one-time state the flow started with.
    state: Option<String>,
    /// The provider's error code, e.g. `access_denied`, on failure.
    error: Option<String>,
    /// The provider's description of the error.
    error_description: Option<String>,
}

/// Why the OAuth callback failed.
#[derive(Debug, thiserror::Error)]
pub enum CallbackError {
    /// The provider refused the authorization.
    #[error("authorization rejected by provider: {0}")]
    Rejected(String),
    /// The redirect carried neither a code nor an error.
    #[error("malformed OAuth callback: missing code and error parameters")]
    Malformed,
    /// Exchanging the code failed.
    #[error("the sign-in could not be completed")]
    Failed,
}

impl IntoResponse for CallbackError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Rejected(_) | Self::Malformed => StatusCode::BAD_REQUEST,
            Self::Failed => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// The redirect's `(code, state)`, or why it carries none.
fn callback_code(params: OAuthCallbackParams) -> Result<(String, String), CallbackError> {
    if let Some(error) = params.error {
        let reason = match params.error_description {
            Some(description) => format!("{error}: {description}"),
            None => error,
        };
        tracing::warn!(reason, "OAuth provider rejected authorization");
        return Err(CallbackError::Rejected(reason));
    }

    match (params.code, params.state) {
        (Some(code), Some(state)) => Ok((code, state)),
        _ => {
            tracing::warn!("OAuth callback missing both code and error parameters");
            Err(CallbackError::Malformed)
        }
    }
}

#[utoipa::path(
    get,
    path = "/mcp/servers/auth/callback",
    tag = "connectors",
    operation_id = "connector_oauth_callback",
    params(OAuthCallbackParams),
    responses(
        (status = 200, description = "Signed in"),
        (status = 400, body = ErrorResponse, description = "The provider refused, or the redirect was malformed"),
        (status = 500, body = ErrorResponse),
    )
)]
/// Finish signing in to a server by URL: the authorization server redirects
/// the browser here with a code or an error.
#[tracing::instrument(skip_all, err)]
pub async fn oauth_callback<G: ServerSignInService>(
    State(state): State<CallbacksState<G>>,
    Query(params): Query<OAuthCallbackParams>,
) -> Result<&'static str, CallbackError> {
    let (code, csrf_state) = callback_code(params)?;
    let signed_in = state
        .sign_ins
        .complete_sign_in(&code, &csrf_state)
        .await
        .map_err(|error| {
            tracing::warn!(error = ?error, "could not complete an MCP server sign-in");
            CallbackError::Failed
        })?;
    fire(
        state.on_connected.as_ref(),
        signed_in.user(),
        signed_in.keys(),
    )
    .await;

    Ok("Authorization successful. You can close this tab.")
}

/// Finish connecting a REST app: its consent page redirects the browser
/// here with a code or an error. Only the one-time state is trusted; the
/// web, polling `POST /connectors/app/{id}/complete`, sees the connection
/// once this stored it.
#[tracing::instrument(name = "connectors.app_oauth_callback", skip_all, err)]
pub async fn app_oauth_callback<G: ServerSignInService>(
    State(state): State<CallbacksState<G>>,
    Query(params): Query<OAuthCallbackParams>,
) -> Result<Html<&'static str>, CallbackError> {
    let (code, csrf_state) = callback_code(params)?;
    let signed_in = state
        .sign_ins
        .complete_app_sign_in(&code, &csrf_state)
        .await
        .map_err(|error| {
            tracing::warn!(error = ?error, "could not complete a REST app sign-in");
            CallbackError::Failed
        })?;
    fire(
        state.on_connected.as_ref(),
        signed_in.user(),
        signed_in.keys(),
    )
    .await;

    Ok(Html(CONSENT_CONNECTED))
}

#[utoipa::path(
    get,
    path = "/mcp/servers/auth/client-metadata",
    tag = "connectors",
    operation_id = "connector_oauth_client_metadata",
    responses(
        (status = 200, description = "Macro's OAuth client metadata document"),
    )
)]
/// Macro's public OAuth Client ID Metadata Document.
pub async fn client_metadata<G: ServerSignInService>(
    State(state): State<CallbacksState<G>>,
) -> Json<serde_json::Value> {
    Json(state.sign_ins.client_metadata())
}

/// Query Macro Connect appends to the consent callback.
#[derive(Debug, Deserialize)]
struct ConsentCallbackQuery {
    /// `connected` or `error`.
    status: Option<String>,
}

const CONSENT_CONNECTED: &str = "<!doctype html><meta charset=utf-8><title>Connected</title><p>Connected. You can close this window and return to Macro.</p><script>window.close()</script>";
const CONSENT_FAILED: &str = "<!doctype html><meta charset=utf-8><title>Not connected</title><p>The connection did not finish. Close this window and try again in Macro.</p>";

/// The page Connect sends the browser to after consent. It records nothing:
/// the app, polling `POST /connectors/{kind}/{id}/complete`, records the
/// connection once Connect confirms it, so nothing in this unauthenticated
/// request is trusted.
#[tracing::instrument(skip_all, fields(status = query.status.as_deref()))]
async fn consent_callback(Query(query): Query<ConsentCallbackQuery>) -> Html<&'static str> {
    Html(match query.status.as_deref() {
        Some("connected") => CONSENT_CONNECTED,
        _ => CONSENT_FAILED,
    })
}

/// The webhook's shared secret.
#[derive(Clone)]
struct WebhookState {
    secret: Arc<str>,
}

/// The secret the configured webhook URI carries.
#[derive(Debug, Deserialize)]
struct WebhookQuery {
    secret: Option<String>,
}

/// Log a connect-flow outcome Pipedream reports.
///
/// The body is raw JSON on purpose: its shape is Pipedream's to change, and
/// an endpoint whose job is telling us why connections fail must not start
/// refusing events the day they add a field. Only opaque ids, the app and
/// Pipedream's error text are logged: the payload also carries the connect
/// token and the account's name, which are personal data.
#[tracing::instrument(skip_all)]
async fn pipedream_webhook(
    State(state): State<WebhookState>,
    Query(query): Query<WebhookQuery>,
    Json(payload): Json<serde_json::Value>,
) -> StatusCode {
    if query.secret.as_deref() != Some(state.secret.as_ref()) {
        // Anyone can reach this route, so the payload stays out of the log.
        tracing::warn!("rejected Pipedream webhook with a bad or missing secret");
        return StatusCode::UNAUTHORIZED;
    }

    let str_at = |pointer: &str| payload.pointer(pointer).and_then(serde_json::Value::as_str);
    let event = str_at("/event");
    let error = str_at("/error");
    let account_id = str_at("/account/id");
    let app_slug = str_at("/account/app/name_slug");
    let connect_session_id = payload.get("connect_session_id").map(ToString::to_string);
    let failed =
        error.is_some() || event.is_some_and(|event| event.to_ascii_uppercase().contains("ERROR"));

    if failed {
        tracing::warn!(
            event,
            error,
            account_id,
            connector.app_slug = app_slug,
            connect_session_id,
            "Pipedream connect flow failed"
        );
    } else {
        tracing::info!(
            event,
            account_id,
            connector.app_slug = app_slug,
            connect_session_id,
            "Pipedream connect flow event"
        );
    }

    StatusCode::NO_CONTENT
}
