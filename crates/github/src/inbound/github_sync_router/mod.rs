//! Github sync router for redirecting users to the github sync app installation page.
//!
//! Provides the following route(s):
//! - `GET /install-sync` - redirects to the github sync app installation page
//! - `GET /sync-redirect` - callback after github app installation, redirects to the app
//! - `POST /webhook` - github event webhook handler

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Router,
    extract::{FromRef, FromRequest, Query, Request, State},
    response::Redirect,
};
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::OptionalMacroUserTeamExtractorV2,
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOnly,
};
use macro_service_urls::AppServiceUrl;
use reqwest::StatusCode;
use uuid::Uuid;

use crate::domain::{
    models::{GithubError, InstallationState, ValidatedGithubWebhookEvent},
    ports::GithubSyncService,
};

/// Router state containing the GitHub sync, entity access, and authorization services.
pub struct GithubSyncRouterState<T, Eas, Auth> {
    /// The GitHub sync service implementation.
    pub service: Arc<T>,
    /// Service used to resolve the authenticated user's optional team.
    pub entity_access_service: Arc<Eas>,
    /// State used to authenticate installation setup requests.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// Manual Clone impl so the services don't need to be Clone (they are behind Arcs).
impl<T, Eas, Auth> Clone for GithubSyncRouterState<T, Eas, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Eas, Auth> FromRef<GithubSyncRouterState<T, Eas, Auth>> for Arc<Eas> {
    fn from_ref(state: &GithubSyncRouterState<T, Eas, Auth>) -> Self {
        state.entity_access_service.clone()
    }
}

impl<T, Eas, Auth> FromRef<GithubSyncRouterState<T, Eas, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &GithubSyncRouterState<T, Eas, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Build the github sync router.
pub fn github_sync_router<T, Eas, Auth, S>(state: GithubSyncRouterState<T, Eas, Auth>) -> Router<S>
where
    T: GithubSyncService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    Router::new()
        .route(
            "/install-sync",
            axum::routing::get(install_sync_handler::<T, Eas, Auth>),
        )
        .route(
            "/sync-redirect",
            axum::routing::get(sync_redirect_handler::<T, Eas, Auth>),
        )
        .route(
            "/webhook",
            axum::routing::post(github_webhook_event_handler::<T, Eas, Auth>),
        )
        .with_state(state)
}

/// Redirects an authenticated user to the github sync app installation page.
#[utoipa::path(
    get,
    path = "/github/install-sync",
    operation_id = "install_sync",
    responses(
        (status = 307, description = "Temporary redirect to the GitHub sync app installation page"),
        (status = 401, description = "Authentication failed"),
    )
)]
#[tracing::instrument(skip(ctx, authorization, team), err)]
pub async fn install_sync_handler<T, Eas, Auth>(
    State(ctx): State<GithubSyncRouterState<T, Eas, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOnly>,
    team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, Eas, Auth>,
) -> Result<Redirect, GithubError>
where
    T: GithubSyncService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let team_id = team
        .entity_access_receipt
        .map(|receipt| Uuid::parse_str(&receipt.entity().entity_id))
        .transpose()
        .map_err(|error| GithubError::Internal(error.into()))?;
    let url = ctx
        .service
        .begin_installation_setup(&authorization.authorization.macro_user_id, team_id)
        .await?;

    Ok(Redirect::temporary(&url))
}

/// Query params received from the GitHub App installation callback.
#[derive(Debug, Default, serde::Deserialize)]
pub struct SyncRedirectParams {
    /// OAuth authorization code from GitHub.
    pub code: Option<String>,
    /// GitHub App installation ID.
    pub installation_id: Option<String>,
    /// Signed Macro installation context.
    pub state: Option<String>,
    /// GitHub's setup result (`install`, `update`, or `request`).
    pub setup_action: Option<String>,
}

/// Completes a GitHub App installation callback and redirects back to Macro.
#[utoipa::path(
    get,
    path = "/github/sync-redirect",
    operation_id = "sync_redirect",
    params(
        ("code" = Option<String>, Query, description = "OAuth authorization code from GitHub"),
        ("installation_id" = Option<String>, Query, description = "GitHub App installation ID"),
        ("state" = Option<String>, Query, description = "Signed Macro installation context"),
        ("setup_action" = Option<String>, Query, description = "GitHub setup result: install, update, or request"),
    ),
    responses(
        (status = 307, description = "Temporary redirect to Macro; callback failures degrade to this redirect"),
    )
)]
#[tracing::instrument(skip_all)]
pub async fn sync_redirect_handler<T, Eas, Auth>(
    State(ctx): State<GithubSyncRouterState<T, Eas, Auth>>,
    Query(params): Query<SyncRedirectParams>,
) -> Redirect
where
    T: GithubSyncService,
    Auth: MacroAuthorizationService,
{
    let state = params.state.as_deref().unwrap_or_default();
    let setup_action = params.setup_action.as_deref().unwrap_or_default();
    let installation_id = params
        .installation_id
        .as_deref()
        .and_then(|value| value.parse::<u64>().ok());

    let result = ctx
        .service
        .complete_installation_setup(state, params.code.as_deref(), installation_id, setup_action)
        .await;

    if let Err(error) = result {
        tracing::error!(error=?error, "failed to complete GitHub installation setup");
        return app_redirect();
    }

    if setup_action != "request" && callback_team_id(state).is_some() {
        return team_settings_redirect();
    }

    app_redirect()
}

fn callback_team_id(state: &str) -> Option<Uuid> {
    let encoded_payload = state.split_once('.')?.0;
    let payload = URL_SAFE_NO_PAD.decode(encoded_payload).ok()?;
    serde_json::from_slice::<InstallationState>(&payload)
        .ok()?
        .team_id
}

fn app_redirect() -> Redirect {
    Redirect::temporary(AppServiceUrl::unwrap_new().as_str())
}

fn team_settings_redirect() -> Redirect {
    let app_url = AppServiceUrl::unwrap_new();
    let destination = format!(
        "{}/app/settings/connections",
        app_url.as_str().trim_end_matches('/')
    );
    Redirect::temporary(&destination)
}

/// Extractor that validates an incoming GitHub webhook event.
///
/// Reads the `X-Hub-Signature-256` header and the raw request body, then
/// delegates to [`GithubSyncService::validate_webhook_event`] for HMAC
/// verification. On success the extractor yields a
/// [`ValidatedGithubWebhookEvent`].
pub struct GithubWebhookEventExtractor(pub ValidatedGithubWebhookEvent);

impl<T, Eas, Auth> FromRequest<GithubSyncRouterState<T, Eas, Auth>> for GithubWebhookEventExtractor
where
    T: GithubSyncService,
    Eas: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    type Rejection = GithubError;

    async fn from_request(
        req: Request,
        state: &GithubSyncRouterState<T, Eas, Auth>,
    ) -> Result<Self, Self::Rejection> {
        let (parts, body) = req.into_parts();

        let event_type = parts
            .headers
            .get("X-GitHub-Event")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("unknown");

        let signature = parts
            .headers
            .get("X-Hub-Signature-256")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("sha256="))
            .ok_or(GithubError::InvalidWebhookSignature)?;

        let body = axum::body::to_bytes(body, usize::MAX)
            .await
            .map_err(|e| GithubError::Internal(e.into()))?;

        let event = state
            .service
            .validate_webhook_event(event_type, signature, &body)
            .await?;

        Ok(GithubWebhookEventExtractor(event))
    }
}

/// The main entrypoint for all github webhook events handling
#[tracing::instrument(err, skip(ctx, event))]
pub async fn github_webhook_event_handler<T, Eas, Auth>(
    State(ctx): State<GithubSyncRouterState<T, Eas, Auth>>,
    GithubWebhookEventExtractor(event): GithubWebhookEventExtractor,
) -> Result<StatusCode, GithubError>
where
    T: GithubSyncService,
{
    tracing::info!("github_webhook");

    ctx.service.process_webhook_event(&event).await?;

    Ok(StatusCode::OK)
}
