//! The document storage service's side of MCP Events: its internal
//! subscription routes (`webhook::inbound::mcp_router`) and its live event
//! stream (`GET /webhook/events/stream`), called as the subscriber with the
//! internal key.

use futures::StreamExt as _;
use futures::stream::BoxStream;
use macro_authorization::inbound::axum::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use sse_core::{SseDecoder, SseEvent, SseStream};
use std::num::NonZeroUsize;
use std::time::Duration;
use webhook::domain::mcp::models::{
    McpSubscribeRequest, McpSubscribeResult, McpSubscriptionErrorBody, McpUnsubscribeRequest,
};
use webhook::domain::models::WebhookFilter;

/// `webhook::inbound::mcp_router::MCP_EVENT_SUBSCRIPTIONS_PATH` under the
/// service's `/internal` nest; the router is behind the webhook crate's
/// `inbound` feature, which this service does not build.
pub(super) const SUBSCRIBE_PATH: &str = "internal/mcp/event_subscriptions";
/// `MCP_EVENT_UNSUBSCRIBE_PATH`, likewise.
const UNSUBSCRIBE_PATH: &str = "internal/mcp/event_subscriptions/unsubscribe";
/// The live event stream webhooks' SSE clients read.
pub(super) const STREAM_PATH: &str = "webhook/events/stream";
/// The stream's heartbeat event, `webhook::domain::stream::STREAM_HEARTBEAT_EVENT`.
const HEARTBEAT_EVENT: &str = "heartbeat";
/// Connecting to the service.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// A subscribe verifies the callback endpoint before answering, so it waits
/// on the subscriber's endpoint as well as the service.
const UNARY_TIMEOUT: Duration = Duration::from_secs(30);
/// The stream sends a heartbeat every 15 s and a keep-alive every 20 s; a
/// read idle this long is a dead connection.
const STREAM_READ_TIMEOUT: Duration = Duration::from_secs(60);
/// Largest event the stream may send.
const MAX_EVENT_BYTES: NonZeroUsize = match NonZeroUsize::new(4 * 1024 * 1024) {
    Some(bytes) => bytes,
    None => NonZeroUsize::MIN,
};

/// Why a subscription call failed.
#[derive(Debug, thiserror::Error)]
pub(crate) enum StoreError {
    /// The service refused it, saying why.
    #[error("subscription refused: {0:?}")]
    Refused(McpSubscriptionErrorBody),
    #[error("subscription call failed")]
    Internal(rootcause::Report),
}

/// Where webhook subscriptions are kept.
// Object-safe (`async_trait`): `McpEvents` holds it as
// `Arc<dyn SubscriptionStore>` so tests can stand in for the service.
#[async_trait::async_trait]
pub(crate) trait SubscriptionStore: Send + Sync {
    async fn subscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &McpSubscribeRequest,
    ) -> Result<McpSubscribeResult, StoreError>;

    async fn unsubscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &McpUnsubscribeRequest,
    ) -> Result<(), StoreError>;
}

/// One event from a source stream.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SourceEvent {
    /// The broker event id.
    pub(crate) event_id: String,
    /// The Macro event name.
    pub(crate) name: String,
    /// The broker envelope webhooks deliver.
    pub(crate) envelope: serde_json::Value,
}

/// What a source stream yields.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum SourceItem {
    Event(SourceEvent),
    /// The source is alive and caught up.
    Heartbeat,
}

/// A source stream failed or could not be opened.
#[derive(Debug, thiserror::Error)]
#[error("event source failed")]
pub(crate) struct SourceError(pub(crate) rootcause::Report);

pub(crate) type SourceStream = BoxStream<'static, Result<SourceItem, SourceError>>;

/// Where the events a stream reads come from.
// Object-safe (`async_trait`): `McpEvents` holds it as `Arc<dyn EventSource>`
// so tests can stand in for the service.
#[async_trait::async_trait]
pub(crate) trait EventSource: Send + Sync {
    /// Open a stream of the user's events that `filter` selects, after
    /// `resume_after` when the source still holds it.
    async fn open(
        &self,
        user: &MacroUserIdStr<'static>,
        filter: &WebhookFilter,
        resume_after: Option<&str>,
    ) -> Result<SourceStream, SourceError>;
}

/// The document storage service over HTTP.
pub(crate) struct DssEvents {
    client: reqwest::Client,
    base_url: url::Url,
    internal_key: String,
}

impl DssEvents {
    pub(crate) fn new(mut base_url: url::Url, internal_key: String) -> anyhow::Result<Self> {
        // The deployed bases sit under a path (`https://gateway…/dss`), and
        // `Url::join` replaces a last segment that has no trailing slash.
        if !base_url.path().ends_with('/') {
            base_url.set_path(&format!("{}/", base_url.path()));
        }
        let client = reqwest::Client::builder()
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(STREAM_READ_TIMEOUT)
            .build()?;
        Ok(Self {
            client,
            base_url,
            internal_key,
        })
    }

    /// Where a call to `path` goes.
    pub(super) fn url(&self, path: &str) -> Result<url::Url, rootcause::Report> {
        self.base_url
            .join(path)
            .map_err(|error| rootcause::Report::new(error).into_dynamic())
    }

    fn request(
        &self,
        method: reqwest::Method,
        path: &str,
        user: &MacroUserIdStr<'static>,
    ) -> Result<reqwest::RequestBuilder, rootcause::Report> {
        let url = self.url(path)?;
        let mut headers = http::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        Ok(self
            .client
            .request(method, url)
            .headers(headers)
            .header(INTERNAL_API_KEY_HEADER, &self.internal_key)
            .header(INTERNAL_MACRO_USER_ID_HEADER, user.as_ref()))
    }

    async fn call(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<reqwest::Response, StoreError> {
        let response = request
            .timeout(UNARY_TIMEOUT)
            .send()
            .await
            .map_err(|error| StoreError::Internal(transport(error)))?;
        if response.status().is_success() {
            return Ok(response);
        }
        let status = response.status();
        match response.json::<McpSubscriptionErrorBody>().await {
            Ok(body) => Err(StoreError::Refused(body)),
            Err(error) => Err(StoreError::Internal(
                rootcause::Report::new(error.without_url())
                    .context(format!("unexpected status {status}"))
                    .into_dynamic(),
            )),
        }
    }
}

#[async_trait::async_trait]
impl SubscriptionStore for DssEvents {
    #[tracing::instrument(name = "mcp_events.store.subscribe", skip_all, err)]
    async fn subscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &McpSubscribeRequest,
    ) -> Result<McpSubscribeResult, StoreError> {
        let builder = self
            .request(reqwest::Method::PUT, SUBSCRIBE_PATH, user)
            .map_err(StoreError::Internal)?
            .json(request);
        self.call(builder)
            .await?
            .json()
            .await
            .map_err(|error| StoreError::Internal(transport(error)))
    }

    #[tracing::instrument(name = "mcp_events.store.unsubscribe", skip_all, err)]
    async fn unsubscribe(
        &self,
        user: &MacroUserIdStr<'static>,
        request: &McpUnsubscribeRequest,
    ) -> Result<(), StoreError> {
        let builder = self
            .request(reqwest::Method::POST, UNSUBSCRIBE_PATH, user)
            .map_err(StoreError::Internal)?
            .json(request);
        self.call(builder).await.map(|_| ())
    }
}

#[async_trait::async_trait]
impl EventSource for DssEvents {
    #[tracing::instrument(
        name = "mcp_events.source.open",
        skip_all,
        fields(event_count = filter.events.len(), resumed = resume_after.is_some()),
        err
    )]
    async fn open(
        &self,
        user: &MacroUserIdStr<'static>,
        filter: &WebhookFilter,
        resume_after: Option<&str>,
    ) -> Result<SourceStream, SourceError> {
        let filters = serde_json::to_string(std::slice::from_ref(filter))
            .map_err(|error| SourceError(rootcause::Report::new(error).into_dynamic()))?;
        let mut builder = self
            .request(reqwest::Method::GET, STREAM_PATH, user)
            .map_err(SourceError)?
            .query(&[("scope", "user"), ("filters", filters.as_str())])
            .header(http::header::ACCEPT, "text/event-stream");
        if let Some(event_id) = resume_after {
            builder = builder
                .query(&[("resume", "true")])
                .header("last-event-id", event_id);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| SourceError(transport(error)))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SourceError(rootcause::report!(
                "event stream answered {status}"
            )));
        }
        let mut events = SseStream::with_decoder(SseDecoder::with_limit(MAX_EVENT_BYTES));
        events.attach(
            response
                .bytes_stream()
                .map(|chunk| chunk.map_err(reqwest::Error::without_url)),
        );
        Ok(events
            .filter_map(|item| async move {
                match item {
                    Ok(SseEvent::Message(message)) => Some(source_item(
                        &message.event,
                        message.data,
                        message.last_event_id.as_deref(),
                    )),
                    Ok(SseEvent::Retry(_)) => None,
                    Err(error) => Some(Err(SourceError(
                        rootcause::Report::new(error).into_dynamic(),
                    ))),
                }
            })
            .boxed())
    }
}

/// A transport error without its URL: the stream's URL carries the filter's
/// event names and ids, which logs and spans must not hold.
fn transport(error: reqwest::Error) -> rootcause::Report {
    rootcause::Report::new(error.without_url()).into_dynamic()
}

/// One SSE message of the event stream.
pub(crate) fn source_item(
    event: &str,
    data: String,
    last_event_id: Option<&str>,
) -> Result<SourceItem, SourceError> {
    if event == HEARTBEAT_EVENT {
        return Ok(SourceItem::Heartbeat);
    }
    let event_id = last_event_id
        .ok_or_else(|| SourceError(rootcause::report!("event without an id")))?
        .to_owned();
    let envelope = serde_json::from_str(&data)
        .map_err(|error| SourceError(rootcause::Report::new(error).into_dynamic()))?;
    Ok(SourceItem::Event(SourceEvent {
        event_id,
        name: event.to_owned(),
        envelope,
    }))
}
