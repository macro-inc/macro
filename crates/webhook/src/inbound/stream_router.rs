//! Axum SSE router for live webhook event streaming.
//!
//! `GET /webhook/events/stream` holds a Server-Sent Events response open and
//! delivers every broker event that matches the caller's filters and passes
//! the caller's entity access. Each SSE event's `id` is the UUIDv7 broker
//! event id and its `event` is the event name; the `data` is the same broker
//! envelope persisted webhooks deliver. Reconnecting clients present the
//! standard `Last-Event-ID` header to resume; a cursor older than the replay
//! window is rejected with 400, in which case clients must resync out of band
//! and reconnect without the header. Clients must deduplicate by event id.

use crate::domain::models::WebhookFilters;
use crate::domain::stream::{WebhookEventStreamService, WebhookStreamError};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::{HeaderMap, StatusCode},
    response::{
        IntoResponse, Response,
        sse::{Event, KeepAlive, Sse},
    },
    routing::get,
};
use futures::{Stream, StreamExt as _};
use macro_authorization::{
    ActingUser, MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState,
};
use model_error_response::ErrorResponse;
use std::convert::Infallible;
use std::time::Duration;
use uuid::Uuid;

/// Interval between SSE comment keep-alives.
///
/// Must stay well under every load balancer idle timeout on the path.
const KEEP_ALIVE_INTERVAL: Duration = Duration::from_secs(20);

/// State for the webhook event stream router.
pub struct WebhookStreamRouterState<St, Auth> {
    stream_service: St,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<St: Clone, Auth> Clone for WebhookStreamRouterState<St, Auth> {
    fn clone(&self) -> Self {
        Self {
            stream_service: self.stream_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<St, Auth> WebhookStreamRouterState<St, Auth> {
    /// Create webhook event stream router state.
    pub fn new(stream_service: St, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            stream_service,
            authorization_state,
        }
    }
}

impl<St, Auth> FromRef<WebhookStreamRouterState<St, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &WebhookStreamRouterState<St, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Create the webhook event stream router.
pub fn webhook_stream_router<St, Auth, T>(state: WebhookStreamRouterState<St, Auth>) -> Router<T>
where
    St: WebhookEventStreamService,
    Auth: MacroAuthorizationService,
    T: Send + Sync + 'static,
{
    Router::new()
        .route("/events/stream", get(stream_events::<St, Auth>))
        .with_state(state)
}

/// Query parameters selecting the events a stream delivers.
#[derive(Debug, serde::Deserialize, utoipa::IntoParams)]
#[into_params(parameter_in = Query)]
pub struct StreamEventsQuery {
    /// URL-encoded JSON array of webhook filters, identical to the persisted
    /// webhook `filters` field.
    pub filters: Option<String>,
}

/// Parse the query's filters into the typed filter model.
fn parse_filters(query: StreamEventsQuery) -> Result<WebhookFilters, WebhookStreamHandlerError> {
    let bad_request =
        |message: String| WebhookStreamHandlerError(WebhookStreamError::BadRequest(message));

    let Some(filters) = query.filters else {
        return Err(bad_request("`filters` is required".to_string()));
    };
    serde_json::from_str(&filters)
        .map_err(|error| bad_request(format!("invalid `filters` JSON: {error}")))
}

/// Parse the standard SSE resume header into a broker event id.
fn parse_last_event_id(headers: &HeaderMap) -> Result<Option<Uuid>, WebhookStreamHandlerError> {
    let Some(value) = headers.get("last-event-id") else {
        return Ok(None);
    };
    value
        .to_str()
        .ok()
        .and_then(|value| Uuid::parse_str(value.trim()).ok())
        .map(Some)
        .ok_or_else(|| {
            WebhookStreamHandlerError(WebhookStreamError::BadRequest(
                "Last-Event-ID must be a broker event id".to_string(),
            ))
        })
}

/// Stream matching broker events to the caller over Server-Sent Events.
#[utoipa::path(
    get,
    path = "/webhook/events/stream",
    params(StreamEventsQuery),
    responses(
        (status = 200, description = "Server-Sent Events stream of matching broker events", content_type = "text/event-stream", body = String),
        (status = 400, description = "Bad request", body = ErrorResponse),
        (status = 403, description = "Forbidden", body = ErrorResponse),
        (status = 429, description = "Too many concurrent streams", body = ErrorResponse),
        (status = 500, description = "Internal server error", body = ErrorResponse),
    ),
    tag = "webhook"
)]
pub async fn stream_events<St: WebhookEventStreamService, Auth: MacroAuthorizationService>(
    State(state): State<WebhookStreamRouterState<St, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, ActingUser>,
    Query(query): Query<StreamEventsQuery>,
    headers: HeaderMap,
) -> Result<
    Sse<impl Stream<Item = Result<Event, Infallible>> + Send + 'static>,
    WebhookStreamHandlerError,
> {
    let filters = parse_filters(query)?;
    let last_event_id = parse_last_event_id(&headers)?;

    let events = state
        .stream_service
        .open_stream(
            authorization.authorization.user.macro_user_id,
            filters,
            last_event_id,
        )
        .await?;

    let events = events.filter_map(|event| async move {
        match Event::default()
            .id(&event.event_id)
            .event(&event.event_name)
            .json_data(&event.broker_envelope)
        {
            Ok(sse_event) => Some(Ok(sse_event)),
            // A broker envelope is already-parsed JSON; failure here is a bug,
            // and the skipped event is still recoverable via reconnect-replay.
            Err(error) => {
                tracing::error!(error = ?error, event_id = %event.event_id, "failed to encode SSE event");
                None
            }
        }
    });

    Ok(Sse::new(events).keep_alive(
        KeepAlive::new()
            .interval(KEEP_ALIVE_INTERVAL)
            .text("keep-alive"),
    ))
}

/// Webhook stream handler error.
pub struct WebhookStreamHandlerError(WebhookStreamError);

impl From<WebhookStreamError> for WebhookStreamHandlerError {
    fn from(error: WebhookStreamError) -> Self {
        Self(error)
    }
}

impl IntoResponse for WebhookStreamHandlerError {
    fn into_response(self) -> Response {
        let status = match self.0 {
            WebhookStreamError::BadRequest(_) => StatusCode::BAD_REQUEST,
            WebhookStreamError::TooManyStreams => StatusCode::TOO_MANY_REQUESTS,
            WebhookStreamError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let message = if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error = ?self.0, "webhook stream handler error");
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
