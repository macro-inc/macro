//! SSE router for live public event streams and the event catalog.
//!
//! `GET /events/stream` holds a Server-Sent Events response open and delivers
//! every public event that matches the caller's filters and whose audience
//! admits the caller. `GET /webhook/events/stream` is the same handler under
//! its original path. Each SSE event's `event` is the event name and its
//! `data` is the envelope persisted webhooks deliver; its `id` is the log
//! cursor (with the `public-event-stream` flag) or the broker event id.
//! Control events (`lagged`, `revoked`, `reset`) precede a server close.
//!
//! A bot listens as the user it acts for: a credential with no acting user
//! is refused (401), as are harness and internal credentials (403).

#[cfg(test)]
mod test;

use crate::domain::catalog::{self, CatalogEntry};
use crate::domain::filters::WebhookFilters;
use crate::domain::models::{PrincipalKind, StreamItem, StreamPrincipal, WebhookScope};
use crate::domain::ports::CredentialCheck;
use crate::domain::stream::{EventStreamService, OpenStream, Resume, StreamError};
use axum::extract::{FromRef, FromRequestParts, Query, State};
use axum::http::{HeaderMap, StatusCode, Uri};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures::{Stream, StreamExt as _};
use macro_authorization::{
    ActingUser, CredentialOrigin, MacroAuthorization, MacroAuthorizationExtractor,
    MacroAuthorizationService, MacroAuthorizationState, USER_API_KEY_HEADER,
};
use model_error_response::ErrorResponse;
use sha2::{Digest as _, Sha256};
use std::convert::Infallible;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use uuid::Uuid;

/// Interval between SSE comment keep-alives; well under every load
/// balancer idle timeout on the path.
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(20);

/// Whether a bot's owner is a given user.
pub trait BotOwners: Clone + Send + Sync + 'static {
    /// Whether `user_id` owns `bot_id`. A team-owned bot has no owning user.
    fn is_owned_by(
        &self,
        bot_id: Uuid,
        user_id: &str,
    ) -> impl Future<Output = Result<bool, rootcause::Report>> + Send;
}

/// State for the event stream router.
pub struct EventStreamRouterState<St, B, Auth> {
    streams: St,
    bot_owners: B,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<St: Clone, B: Clone, Auth> Clone for EventStreamRouterState<St, B, Auth> {
    fn clone(&self) -> Self {
        Self {
            streams: self.streams.clone(),
            bot_owners: self.bot_owners.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<St, B, Auth> EventStreamRouterState<St, B, Auth> {
    /// Create router state.
    pub fn new(
        streams: St,
        bot_owners: B,
        authorization_state: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self {
            streams,
            bot_owners,
            authorization_state,
        }
    }
}

impl<St, B, Auth> FromRef<EventStreamRouterState<St, B, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &EventStreamRouterState<St, B, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// The event stream and catalog routes, mounted at the API root.
pub fn event_stream_router<St, B, Auth, T>(state: EventStreamRouterState<St, B, Auth>) -> Router<T>
where
    St: EventStreamService,
    B: BotOwners,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/events/stream", get(stream_events::<St, B, Auth>))
        .route("/webhook/events/stream", get(stream_events::<St, B, Auth>))
        .route("/events/catalog", get(event_catalog::<St, B, Auth>))
        .with_state(state)
}

/// Query parameters selecting the events a stream delivers.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct StreamEventsQuery {
    /// Personal or team workspace whose webhook lifecycle events are delivered.
    pub scope: WebhookScope,
    /// URL-encoded JSON array of filters, identical to the persisted webhook
    /// `filters` field.
    pub filters: Option<String>,
    /// Resume after this cursor (an SSE `id`). `Last-Event-ID` wins when both
    /// are sent. Requires the `public-event-stream` feature; ignored without
    /// it.
    pub cursor: Option<String>,
}

/// The stream principal for an authenticated caller.
async fn principal<B: BotOwners>(
    authorization: &MacroAuthorization,
    acting_user: &macro_authorization::MacroUserAuthentication,
    headers: &HeaderMap,
    bot_owners: &B,
) -> Result<StreamPrincipal, StreamHandlerError> {
    let user = acting_user.macro_user_id.clone();
    match authorization {
        MacroAuthorization::Bot(bot) => {
            let bot_id = bot.bot_id.as_uuid();
            let owned_by_user = bot_owners
                .is_owned_by(bot_id, user.as_ref())
                .await
                .map_err(|error| StreamHandlerError(StreamError::Internal(error)))?;
            Ok(StreamPrincipal {
                kind: PrincipalKind::Bot {
                    bot_id,
                    user,
                    owned_by_user,
                },
                credential_id: format!("bot_token:{}", bot.token_id),
            })
        }
        MacroAuthorization::User(_) => match &acting_user.origin {
            CredentialOrigin::AccountManager(manager) => Ok(StreamPrincipal {
                kind: PrincipalKind::AccountManager { user },
                credential_id: format!("account_manager_grant:{}", manager.grant_id),
            }),
            CredentialOrigin::UserApiKey => Ok(StreamPrincipal {
                kind: PrincipalKind::User {
                    user,
                    api_key: true,
                },
                credential_id: format!("api_key:{}", api_key_digest(headers)),
            }),
            _ => Ok(StreamPrincipal {
                kind: PrincipalKind::User {
                    user,
                    api_key: false,
                },
                credential_id: "session".to_owned(),
            }),
        },
        MacroAuthorization::Harness(_) | MacroAuthorization::Internal(_) => {
            Err(StreamHandlerError(StreamError::Forbidden))
        }
    }
}

/// An opaque, stable id for the API key on the request: a truncated SHA-256
/// of the key, never the key.
fn api_key_digest(headers: &HeaderMap) -> String {
    let key = headers
        .get(USER_API_KEY_HEADER)
        .map(|value| value.as_bytes())
        .unwrap_or_default();
    hex::encode(&Sha256::digest(key)[..12])
}

/// Re-runs request authentication on the headers the stream was opened with.
struct RequestCredential<Auth> {
    headers: HeaderMap,
    uri: Uri,
    user: String,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<Auth: MacroAuthorizationService> CredentialCheck for RequestCredential<Auth> {
    fn still_valid(&self) -> futures::future::BoxFuture<'_, Result<bool, rootcause::Report>> {
        Box::pin(async move {
            let mut request = axum::http::Request::builder()
                .uri(self.uri.clone())
                .body(())
                .map_err(|error| rootcause::report!(error))?;
            *request.headers_mut() = self.headers.clone();
            let (mut parts, ()) = request.into_parts();
            let authorized = MacroAuthorizationExtractor::<Auth, ActingUser>::from_request_parts(
                &mut parts,
                &self.authorization_state,
            )
            .await;
            Ok(authorized.is_ok_and(|authorized| {
                authorized.authorization.user.macro_user_id.as_ref() == self.user
            }))
        })
    }
}

fn parse_filters(filters: Option<String>) -> Result<WebhookFilters, StreamHandlerError> {
    let bad_request = |message: String| StreamHandlerError(StreamError::BadRequest(message));
    let Some(filters) = filters else {
        return Err(bad_request("`filters` is required".to_string()));
    };
    serde_json::from_str(&filters)
        .map_err(|error| bad_request(format!("invalid `filters` JSON: {error}")))
}

fn sse_event(item: StreamItem) -> Option<Event> {
    let encoded = match &item {
        StreamItem::Event { id, event } => Event::default()
            .id(id)
            .event(&event.event_name)
            .json_data(&event.broker_envelope),
        StreamItem::Control(control) => Event::default().event(control.name()).json_data(control),
    };
    match encoded {
        Ok(event) => Some(event),
        // The data is already-parsed JSON; failure here is a bug.
        Err(error) => {
            tracing::error!(error = ?error, "failed to encode an SSE event");
            None
        }
    }
}

/// Stream matching public events to the caller over Server-Sent Events.
#[utoipa::path(
    get,
    path = "/events/stream",
    params(StreamEventsQuery),
    responses(
        (status = 200, description = "Server-Sent Events stream of matching public events, ending with a `lagged`, `revoked` or `reset` control event when the server closes it", content_type = "text/event-stream", body = String),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 401, description = "No acting user", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 410, description = "The cursor is older than the replay window: resync, then reconnect without a cursor", body = ErrorResponse),
        (status = 429, description = "Too many concurrent streams for this credential", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "events"
)]
pub async fn stream_events<St, B, Auth>(
    State(state): State<EventStreamRouterState<St, B, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, ActingUser>,
    headers: HeaderMap,
    uri: Uri,
    Query(query): Query<StreamEventsQuery>,
) -> Result<Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static>, StreamHandlerError>
where
    St: EventStreamService,
    B: BotOwners,
    Auth: MacroAuthorizationService,
{
    let filters = parse_filters(query.filters)?;
    let acting_user = &authorization.authorization.user;
    let principal = principal(
        &authorization.authorization.principal,
        acting_user,
        &headers,
        &state.bot_owners,
    )
    .await?;
    let resume = headers
        .get("last-event-id")
        .and_then(|value| value.to_str().ok())
        .map(|value| Resume::LastEventId(value.to_owned()))
        .or(query.cursor.map(Resume::Cursor));
    let credential = Arc::new(RequestCredential {
        headers,
        uri,
        user: acting_user.macro_user_id.as_ref().to_owned(),
        authorization_state: state.authorization_state.clone(),
    });

    let items = state
        .streams
        .open_stream(OpenStream {
            principal,
            scope: query.scope,
            filters,
            resume,
            credential,
        })
        .await?;
    let events = items.filter_map(|item| async move { sse_event(item).map(Ok) });

    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(KEEP_ALIVE_INTERVAL)
            .text("keep-alive"),
    ))
}

/// OpenAPI entry for [`stream_events`] under its original path, kept while
/// clients still call it; the route itself is served by [`stream_events`].
#[utoipa::path(
    get,
    path = "/webhook/events/stream",
    params(StreamEventsQuery),
    responses(
        (status = 200, description = "Server-Sent Events stream; see `/events/stream`", content_type = "text/event-stream", body = String),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 401, description = "No acting user", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 410, description = "Cursor older than the replay window", body = ErrorResponse),
        (status = 429, description = "Too many concurrent streams", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub fn stream_events_alias() {}

/// The public events visible to a credential.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct EventCatalog {
    /// Every event this credential can receive, with its entity types, rule
    /// classes and rollout stage.
    pub events: Vec<CatalogEntry>,
}

/// List the public events this credential can receive.
#[utoipa::path(
    get,
    path = "/events/catalog",
    responses(
        (status = 200, description = "The events this credential can receive", body = EventCatalog),
        (status = 401, description = "No acting user", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 404, description = "The catalog is not enabled for this user", body = ErrorResponse),
    ),
    tag = "events"
)]
pub async fn event_catalog<St, B, Auth>(
    State(state): State<EventStreamRouterState<St, B, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, ActingUser>,
    headers: HeaderMap,
) -> Result<Json<EventCatalog>, StreamHandlerError>
where
    St: EventStreamService,
    B: BotOwners,
    Auth: MacroAuthorizationService,
{
    let principal = principal(
        &authorization.authorization.principal,
        &authorization.authorization.user,
        &headers,
        &state.bot_owners,
    )
    .await?;
    if !state.streams.preview_enabled(&principal).await {
        return Err(StreamHandlerError(StreamError::NotEnabled));
    }
    Ok(Json(EventCatalog {
        events: catalog::visible_to(&principal, true)
            .into_iter()
            .copied()
            .collect(),
    }))
}

/// Stream handler error.
pub struct StreamHandlerError(StreamError);

impl From<StreamError> for StreamHandlerError {
    fn from(error: StreamError) -> Self {
        Self(error)
    }
}

impl IntoResponse for StreamHandlerError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            StreamError::BadRequest(_) => StatusCode::BAD_REQUEST,
            StreamError::Forbidden => StatusCode::FORBIDDEN,
            StreamError::NotEnabled => StatusCode::NOT_FOUND,
            StreamError::TooManyStreams => StatusCode::TOO_MANY_REQUESTS,
            StreamError::CursorExpired => StatusCode::GONE,
            StreamError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self.0, "event stream handler error");
            "internal server error".to_string()
        } else {
            self.0.to_string()
        };
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}
