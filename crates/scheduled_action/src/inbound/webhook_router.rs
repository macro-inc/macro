//! Routine webhooks over HTTP: the owner's routes that mint, show and revoke
//! a routine's URL, and the public route that URL names.
//!
//! The public route takes no Macro credential and gets no CORS: browsers
//! can't call it from other sites, and nothing about it reads cookies. Its
//! secret travels only as a bearer token, which no layer records; a path
//! longer than the hook id is unknown, traced by its route, not its path.

use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::{DefaultBodyLimit, FromRef, Path, State};
use axum::http::header::{AUTHORIZATION, CACHE_CONTROL, CONTENT_TYPE, RETRY_AFTER};
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use chrono::{DateTime, Utc};
use entity_access::domain::models::EditAccessLevel;
use entity_access::domain::ports::EntityAccessService;
use entity_access::inbound::axum_extractors::ScheduledActionAccessExtractor;
use entity_registry::NonUserOwners;
use ip_extractor::{ClientIp, ClientIpError};
use macro_authorization::{
    CredentialAttribution, MacroAuthorizationExtractor, MacroAuthorizationService,
    MacroAuthorizationState, MacroUserAuthentication, UserOnly,
};
use macro_uuid::Uuid;
use serde::Serialize;
use utoipa::ToSchema;

use crate::domain::webhook::{
    Delivered, DeliveryError, DeliveryRequest, MAX_BODY_BYTES, ManagingCaller,
    RoutineWebhookService, WebhookInfo, WebhookManagementError,
};

#[cfg(test)]
mod test;

const IDEMPOTENCY_KEY: &str = "idempotency-key";

pub struct WebhookRouterState<W, Svc, Auth> {
    pub service: Arc<W>,
    pub access_service: Arc<Svc>,
    pub authorization_state: MacroAuthorizationState<Auth>,
    /// Where senders off Macro's network reach the public route, such as
    /// `https://gateway.macro.com/scheduled-action`; a URL is this, then
    /// `/hooks/{hook_id}`.
    pub public_base: Arc<str>,
}

impl<W, Svc, Auth> Clone for WebhookRouterState<W, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
            access_service: Arc::clone(&self.access_service),
            authorization_state: self.authorization_state.clone(),
            public_base: Arc::clone(&self.public_base),
        }
    }
}

impl<W, Svc, Auth> FromRef<WebhookRouterState<W, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &WebhookRouterState<W, Svc, Auth>) -> Self {
        Arc::clone(&state.access_service)
    }
}

impl<W, Svc, Auth> FromRef<WebhookRouterState<W, Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &WebhookRouterState<W, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// A team bot reaches the domain, which refuses anyone but the owner.
impl<W, Svc, Auth> FromRef<WebhookRouterState<W, Svc, Auth>> for NonUserOwners {
    fn from_ref(_state: &WebhookRouterState<W, Svc, Auth>) -> Self {
        NonUserOwners::Enabled
    }
}

/// The owner's routes, served with the rest of the routines API.
pub fn webhook_management_router<W, Svc, Auth, St>(
    state: WebhookRouterState<W, Svc, Auth>,
) -> Router<St>
where
    W: RoutineWebhookService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Send + Sync,
{
    Router::new()
        .route(
            "/scheduled-actions/{id}/webhook",
            get(get_webhook::<W, Svc, Auth>)
                .post(mint_webhook::<W, Svc, Auth>)
                .delete(remove_webhook::<W, Svc, Auth>),
        )
        .with_state(state)
}

/// The public routes a webhook URL names. Mount them outside CORS.
pub fn webhook_delivery_router<W, St>(service: Arc<W>) -> Router<St>
where
    W: RoutineWebhookService,
    St: Send + Sync,
{
    Router::new()
        // `{code}` is a credential path parameter: request spans record the
        // route's placeholder in its place. The hook id is traced by the
        // domain once the secret matches.
        .route("/hooks/{code}", post(deliver_routine_webhook::<W>))
        // Anything longer is unknown, as a URL with the secret in its path
        // is, and is traced by its route, so no such secret reaches a span.
        .route("/hooks/{code}/", post(not_found))
        .route("/hooks/{code}/{*rest}", post(not_found))
        .layer(DefaultBodyLimit::max(MAX_BODY_BYTES))
        .with_state(service)
}

/// Who asks: the routine's owner in person, or an agent's code, a routine's
/// run or a bot, read from the request's verified credential: a person's own
/// session (never an API token), signed for no agent or routine run, with no
/// agent context on the request.
fn managing_caller(user: &MacroUserAuthentication) -> ManagingCaller {
    let agent = !user.is_human_session()
        || user.attribution() != CredentialAttribution::Person
        || agent_correlation::context::current().is_some()
        || agent_correlation::context::current_session().is_some()
        || agent_correlation::context::current_scope().is_some()
        || agent_correlation::context::current_routine().is_some();
    if agent {
        ManagingCaller::Agent
    } else {
        ManagingCaller::Person
    }
}

/// A routine's webhook, if it has a URL.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebhookStatusResponse {
    pub webhook: Option<WebhookInfo>,
}

/// A new webhook URL and its secret. The secret is shown this once: Macro
/// keeps only its hash.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MintedWebhookResponse {
    #[schema(value_type = String, format = Uuid)]
    pub hook_id: Uuid,
    /// POST here with `Authorization: Bearer <secret>` to start a run.
    pub url: String,
    pub secret: String,
    pub created_at: DateTime<Utc>,
}

/// An accepted delivery: the run it started, or none when the body failed
/// the trigger's payload tests.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebhookDeliveryResponse {
    #[schema(value_type = Option<String>, format = Uuid)]
    pub run_id: Option<Uuid>,
}

#[utoipa::path(
    get,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "get_scheduled_action_webhook",
    params(("id" = String, Path, description = "ID of the routine")),
    responses(
        (status = 200, body = WebhookStatusResponse),
        (status = 401), (status = 403), (status = 404),
    ),
)]
pub async fn get_webhook<W, Svc, Auth>(
    State(state): State<WebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
    MacroAuthorizationExtractor { authorization, .. }: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Json<WebhookStatusResponse>, WebhookManagementError>
where
    W: RoutineWebhookService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let webhook = state
        .service
        .status(&entity_access_receipt, managing_caller(&authorization))
        .await?;
    Ok(Json(WebhookStatusResponse { webhook }))
}

#[utoipa::path(
    post,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "mint_scheduled_action_webhook",
    description = "Mint the routine's webhook URL and secret, replacing any it had: the old ones stop at once. The response is the only time the secret is shown. Only the routine's owner, signed in as themselves, may call it; agent sessions' code and routine runs are refused.",
    params(("id" = String, Path, description = "ID of the routine")),
    responses(
        (status = 201, body = MintedWebhookResponse),
        (status = 401), (status = 403), (status = 404),
        (status = 409, description = "The routine has no webhook trigger"),
    ),
)]
pub async fn mint_webhook<W, Svc, Auth>(
    State(state): State<WebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
    MacroAuthorizationExtractor { authorization, .. }: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<Response, WebhookManagementError>
where
    W: RoutineWebhookService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let minted = state
        .service
        .mint(&entity_access_receipt, managing_caller(&authorization))
        .await?;
    let body = MintedWebhookResponse {
        hook_id: minted.hook_id.as_uuid(),
        url: format!("{}/hooks/{}", state.public_base, minted.hook_id),
        secret: minted.secret.expose().to_owned(),
        created_at: minted.created_at,
    };
    Ok((
        StatusCode::CREATED,
        [(CACHE_CONTROL, HeaderValue::from_static("no-store"))],
        Json(body),
    )
        .into_response())
}

#[utoipa::path(
    delete,
    path = "/scheduled-actions/{id}/webhook",
    tag = "scheduled actions",
    operation_id = "remove_scheduled_action_webhook",
    description = "Revoke the routine's webhook URL. The trigger stays until the routine is saved without it.",
    params(("id" = String, Path, description = "ID of the routine")),
    responses((status = 204), (status = 401), (status = 403), (status = 404)),
)]
pub async fn remove_webhook<W, Svc, Auth>(
    State(state): State<WebhookRouterState<W, Svc, Auth>>,
    ScheduledActionAccessExtractor {
        entity_access_receipt,
        ..
    }: ScheduledActionAccessExtractor<EditAccessLevel, Svc, Auth>,
    MacroAuthorizationExtractor { authorization, .. }: MacroAuthorizationExtractor<Auth, UserOnly>,
) -> Result<StatusCode, WebhookManagementError>
where
    W: RoutineWebhookService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let removed = state
        .service
        .remove(&entity_access_receipt, managing_caller(&authorization))
        .await?;
    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(WebhookManagementError::NotFound)
    }
}

impl IntoResponse for WebhookManagementError {
    fn into_response(self) -> Response {
        let status = match &self {
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::NoWebhookTrigger => StatusCode::CONFLICT,
            Self::NotOwnerInPerson => StatusCode::FORBIDDEN,
            Self::Unavailable(error) => {
                tracing::warn!(error = ?error, "routine webhook flag unavailable");
                return (StatusCode::SERVICE_UNAVAILABLE, "Unavailable").into_response();
            }
            Self::Internal(error) => {
                tracing::error!(error = ?error, "routine webhook management failed");
                return (StatusCode::INTERNAL_SERVER_ERROR, "Internal error").into_response();
            }
        };
        (status, self.to_string()).into_response()
    }
}

#[utoipa::path(
    post,
    path = "/hooks/{hook_id}",
    tag = "routine webhooks",
    operation_id = "deliver_routine_webhook",
    description = "Start a run of the routine this webhook URL belongs to, with the body (UTF-8 text, at most 64 KiB; a JSON body is checked against the trigger's payload tests) as its trigger data. Send the webhook's secret as `Authorization: Bearer <secret>`. Answers 202 at once with the run's id, or 200 without one when the body fails the payload tests. A repeated Idempotency-Key within a day answers with the first run. An unknown, rotated or removed URL, a missing or wrong secret, or a routine whose owner has webhooks off is 404.",
    params(
        ("hook_id" = String, Path, description = "The webhook's public id"),
        ("Idempotency-Key" = Option<String>, Header, description = "Up to 255 visible ASCII characters"),
    ),
    request_body(
        description = "Any UTF-8 text up to 64 KiB, of any content type; JSON is parsed for the payload tests and code",
        content((serde_json::Value = "application/json"), (String = "text/plain")),
    ),
    responses(
        (status = 200, body = WebhookDeliveryResponse, description = "The body failed the trigger's payload tests: no run"),
        (status = 202, body = WebhookDeliveryResponse),
        (status = 400, description = "The body is not UTF-8 text, or the key is invalid"),
        (status = 404),
        (status = 409, description = "The routine is paused"),
        (status = 413),
        (status = 429, description = "Too many requests, or too many runs waiting"),
        (status = 503, description = "Webhooks can't be checked right now; retry later"),
    ),
)]
pub async fn deliver_routine_webhook<W: RoutineWebhookService>(
    State(service): State<Arc<W>>,
    Path(hook_id): Path<String>,
    address: Result<ClientIp, ClientIpError>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let secret = headers
        .get(AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .unwrap_or_default()
        .trim()
        .to_owned();
    deliver(&*service, &hook_id, &secret, address, &headers, &body).await
}

async fn not_found() -> Response {
    DeliveryError::NotFound.into_response()
}

async fn deliver<W: RoutineWebhookService>(
    service: &W,
    hook_id: &str,
    secret: &str,
    address: Result<ClientIp, ClientIpError>,
    headers: &HeaderMap,
    body: &[u8],
) -> Response {
    let idempotency_key = match headers.get(IDEMPOTENCY_KEY).map(HeaderValue::to_str) {
        None => None,
        Some(Ok(key)) => Some(key.to_owned()),
        Some(Err(_)) => return DeliveryError::InvalidIdempotencyKey.into_response(),
    };
    let request = DeliveryRequest {
        hook_id,
        secret,
        // Behind the load balancer the rightmost forwarded address is the
        // caller's; without one, callers share a count.
        address: address.ok().map(|address| address.origin_ip()),
        body,
        content_type: headers
            .get(CONTENT_TYPE)
            .and_then(|value| value.to_str().ok()),
        idempotency_key,
    };
    match service.receive(request).await {
        Ok(Delivered::Started { run_id } | Delivered::Repeated { run_id }) => (
            StatusCode::ACCEPTED,
            Json(WebhookDeliveryResponse {
                run_id: Some(run_id),
            }),
        )
            .into_response(),
        Ok(Delivered::Unmatched) => (
            StatusCode::OK,
            Json(WebhookDeliveryResponse { run_id: None }),
        )
            .into_response(),
        Err(error) => error.into_response(),
    }
}

impl IntoResponse for DeliveryError {
    fn into_response(self) -> Response {
        let retry = |status: StatusCode, after: std::time::Duration, message: String| {
            let seconds = after.as_secs().max(1).to_string();
            let mut response = (status, message).into_response();
            if let Ok(value) = HeaderValue::from_str(&seconds) {
                response.headers_mut().insert(RETRY_AFTER, value);
            }
            response
        };
        match self {
            // Exactly what a route that does not exist answers, so a URL
            // that leads nowhere looks like no URL at all.
            Self::NotFound | Self::NotEnabled => StatusCode::NOT_FOUND.into_response(),
            Self::TooManyRequests { retry_after } | Self::Busy { retry_after } => {
                let message = self.to_string();
                retry(StatusCode::TOO_MANY_REQUESTS, retry_after, message)
            }
            Self::TooLarge => (StatusCode::PAYLOAD_TOO_LARGE, self.to_string()).into_response(),
            Self::NotText | Self::InvalidIdempotencyKey => {
                (StatusCode::BAD_REQUEST, self.to_string()).into_response()
            }
            Self::Paused => (StatusCode::CONFLICT, self.to_string()).into_response(),
            Self::Unavailable(_) => {
                (StatusCode::SERVICE_UNAVAILABLE, "Unavailable").into_response()
            }
        }
    }
}
