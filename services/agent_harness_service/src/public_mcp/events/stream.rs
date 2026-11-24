//! `events/stream`: one held request pushing a subscription's events as
//! notifications until the client goes away.
//!
//! A compiled filter is read from the document storage service's live event
//! stream, one source per distinct `ids` among its alternatives
//! (`McpEventFilter::stream_groups`). Each source reconnects on its own,
//! resuming after the last event it gave while the service still holds it,
//! and reports the outage as a recoverable `notifications/events/error`.

use super::dss::{EventSource, SourceError, SourceEvent, SourceItem, SourceStream};
use futures::StreamExt as _;
use futures::stream::{self, BoxStream};
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::{Value, json};
use std::collections::{HashSet, VecDeque};
use std::sync::Arc;
use std::time::Duration;
use tokio_util::sync::CancellationToken;
use webhook::domain::mcp::filter::{McpEventFilter, McpStreamGroup};

/// The `_meta` key the extension correlates a stream's notifications by.
pub(crate) const SUBSCRIPTION_ID_META: &str = "io.modelcontextprotocol/subscriptionId";
/// Heartbeat granted when the client suggests none (the spec's default).
pub(crate) const DEFAULT_HEARTBEAT: Duration = Duration::from_secs(30);
/// Shortest heartbeat granted.
pub(crate) const MIN_HEARTBEAT: Duration = Duration::from_secs(5);
/// Longest heartbeat granted: under the load balancer's idle timeout.
pub(crate) const MAX_HEARTBEAT: Duration = Duration::from_secs(45);
/// Event ids remembered to drop an event a second source also gave: as many
/// as the source retains for resuming, so a group catching up from it cannot
/// repeat one another group gave.
const RECENT_EVENT_IDS: usize = 4096;
/// A source that sends neither an event nor a heartbeat for this long has
/// stalled, even while its keep-alive comments hold the connection open.
const SOURCE_SILENCE: Duration =
    webhook::domain::models::STREAM_HEARTBEAT_INTERVAL.saturating_mul(3);
/// First wait before reconnecting a source.
const FIRST_RETRY: Duration = Duration::from_millis(500);
/// Longest wait between reconnects.
const MAX_RETRY: Duration = Duration::from_secs(30);

/// Where a stream's notifications go.
pub(crate) trait NotificationSink: Send + Sync {
    /// Send one notification; an error means the client is gone.
    fn send(
        &self,
        method: &'static str,
        params: Value,
    ) -> impl Future<Output = Result<(), SinkClosed>> + Send;
}

/// The client is gone.
#[derive(Debug)]
pub(crate) struct SinkClosed;

impl NotificationSink for rmcp::service::Peer<rmcp::RoleServer> {
    async fn send(&self, method: &'static str, params: Value) -> Result<(), SinkClosed> {
        self.send_notification(rmcp::model::ServerNotification::CustomNotification(
            rmcp::model::CustomNotification::new(method, Some(params)),
        ))
        .await
        .map_err(|_| SinkClosed)
    }
}

/// How a stream ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum StreamEnd {
    /// The client cancelled or disconnected.
    Cancelled,
    /// A notification could not be sent.
    ClientGone,
}

/// What one stream delivers.
pub(crate) struct StreamPlan {
    /// The subscription's event type name, which each occurrence carries.
    pub(crate) name: String,
    /// The JSON-RPC id of the `events/stream` request.
    pub(crate) subscription_id: Value,
    pub(crate) filter: McpEventFilter,
    pub(crate) interpretation: String,
    pub(crate) heartbeat: Duration,
}

/// Counts for the stream's closing log.
#[derive(Debug, Default, Clone, Copy)]
pub(crate) struct StreamStats {
    pub(crate) delivered: u64,
    pub(crate) source_errors: u64,
}

/// A stream's sources, opened live.
pub(crate) struct OpenedSources {
    /// Minted before the first source opened: where a source lost before
    /// its first event resumes from, and the oldest event a resumed source
    /// may give, since resuming replays a few seconds from before the
    /// cursor.
    opened_at: uuid::Uuid,
    groups: Vec<(McpStreamGroup, SourceStream)>,
}

impl OpenedSources {
    /// How many sources the stream reads.
    pub(crate) fn len(&self) -> usize {
        self.groups.len()
    }
}

/// Open every source; an error here fails the request before any
/// notification, as the spec asks.
pub(crate) async fn open_sources(
    source: &Arc<dyn EventSource>,
    user: &MacroUserIdStr<'static>,
    filter: &McpEventFilter,
) -> Result<OpenedSources, SourceError> {
    let opened_at = uuid::Uuid::now_v7();
    let mut groups = Vec::new();
    for group in filter.stream_groups() {
        let stream = source.open(user, &group.source, None).await?;
        groups.push((group, stream));
    }
    Ok(OpenedSources { opened_at, groups })
}

/// Deliver until the client goes away.
pub(crate) async fn run(
    sink: &impl NotificationSink,
    source: Arc<dyn EventSource>,
    user: MacroUserIdStr<'static>,
    sources: OpenedSources,
    plan: StreamPlan,
    cancel: CancellationToken,
) -> (StreamEnd, StreamStats) {
    let mut stats = StreamStats::default();
    let meta = json!({ SUBSCRIPTION_ID_META: plan.subscription_id });
    let active = json!({
        "cursor": null,
        "truncated": false,
        "heartbeatMs": u64::try_from(plan.heartbeat.as_millis()).unwrap_or(u64::MAX),
        "_meta": {
            SUBSCRIPTION_ID_META: plan.subscription_id,
            "com.macro/filter": plan.filter,
            "com.macro/interpretation": plan.interpretation,
        },
    });
    if let Err(end) = send(sink, &cancel, "notifications/events/active", active).await {
        return (end, stats);
    }
    let opened_at = sources.opened_at;
    let mut merged = stream::select_all(sources.groups.into_iter().map(|(group, opened)| {
        group_stream(Arc::clone(&source), user.clone(), group, opened, opened_at)
    }));
    let mut recent = RecentIds::default();
    let heartbeat = tokio::time::sleep(plan.heartbeat);
    tokio::pin!(heartbeat);
    loop {
        let (method, params) = tokio::select! {
            biased;
            () = cancel.cancelled() => return (StreamEnd::Cancelled, stats),
            item = merged.next() => match item {
                Some(GroupItem::Event(event)) => {
                    if !recent.insert(&event.event_id) {
                        continue;
                    }
                    stats.delivered += 1;
                    ("notifications/events/event", occurrence(&plan.name, event, &meta))
                }
                Some(GroupItem::Lost) => {
                    stats.source_errors += 1;
                    (
                        "notifications/events/error",
                        json!({
                            "error": {
                                "code": rmcp::model::ErrorCode::INTERNAL_ERROR.0,
                                "message": "UpstreamError",
                                "data": {"reason": "the event source disconnected; reconnecting"},
                            },
                            "_meta": meta,
                        }),
                    )
                }
                // Sources reconnect forever, so the merge never ends.
                None => return (StreamEnd::Cancelled, stats),
            },
            () = &mut heartbeat => (
                "notifications/events/heartbeat",
                json!({"cursor": null, "_meta": meta}),
            ),
        };
        if let Err(end) = send(sink, &cancel, method, params).await {
            return (end, stats);
        }
        heartbeat
            .as_mut()
            .reset(tokio::time::Instant::now() + plan.heartbeat);
    }
}

/// Sends one notification unless the request is cancelled first: a client
/// that stops reading leaves a send pending, and the user's stream slot is
/// released only when [`run`] returns.
async fn send(
    sink: &impl NotificationSink,
    cancel: &CancellationToken,
    method: &'static str,
    params: Value,
) -> Result<(), StreamEnd> {
    tokio::select! {
        biased;
        () = cancel.cancelled() => Err(StreamEnd::Cancelled),
        sent = sink.send(method, params) => sent.map_err(|_| StreamEnd::ClientGone),
    }
}

/// The `EventOccurrence` of `event` for a subscription named `name`.
fn occurrence(name: &str, event: SourceEvent, meta: &Value) -> Value {
    let timestamp = uuid::Uuid::parse_str(&event.event_id)
        .ok()
        .and_then(|id| id.get_timestamp())
        .and_then(|timestamp| {
            let (seconds, nanos) = timestamp.to_unix();
            chrono::DateTime::from_timestamp(i64::try_from(seconds).ok()?, nanos)
        })
        .unwrap_or_else(chrono::Utc::now);
    json!({
        "eventId": event.event_id,
        "name": name,
        "timestamp": timestamp,
        "data": event.envelope,
        "cursor": null,
        "_meta": meta,
    })
}

/// What one source contributes to the stream.
#[derive(Debug)]
enum GroupItem {
    /// An event the group's filter matched.
    Event(SourceEvent),
    /// The source failed; it reconnects after a wait.
    Lost,
}

struct GroupState {
    source: Arc<dyn EventSource>,
    user: MacroUserIdStr<'static>,
    group: McpStreamGroup,
    current: Option<SourceStream>,
    last_event_id: Option<String>,
    opened_at: uuid::Uuid,
    /// Whether `current` was opened with a resume cursor and may still be
    /// replaying events from before the stream opened: until its first
    /// heartbeat.
    resumed: bool,
    failures: u32,
}

impl GroupState {
    /// An event a resumed source replayed from before the stream opened.
    /// Ids are UUIDv7, so they compare by when they were minted.
    fn predates_stream(&self, event_id: &str) -> bool {
        self.resumed && uuid::Uuid::parse_str(event_id).is_ok_and(|id| id < self.opened_at)
    }
}

/// One source's matched events, reconnecting after failures.
fn group_stream(
    source: Arc<dyn EventSource>,
    user: MacroUserIdStr<'static>,
    group: McpStreamGroup,
    opened: SourceStream,
    opened_at: uuid::Uuid,
) -> BoxStream<'static, GroupItem> {
    let state = GroupState {
        source,
        user,
        group,
        current: Some(opened),
        // A group that loses its source before its first event resumes from
        // when the stream opened.
        last_event_id: Some(opened_at.to_string()),
        opened_at,
        resumed: false,
        failures: 0,
    };
    stream::unfold(state, |mut state| async move {
        loop {
            let Some(current) = state.current.as_mut() else {
                tokio::time::sleep(retry_delay(state.failures)).await;
                match state
                    .source
                    .open(
                        &state.user,
                        &state.group.source,
                        state.last_event_id.as_deref(),
                    )
                    .await
                {
                    Ok(opened) => {
                        state.current = Some(opened);
                        state.resumed = true;
                    }
                    Err(error) => {
                        tracing::warn!(error = ?error.0, "MCP events source reconnect failed");
                        state.failures = state.failures.saturating_add(1);
                        return Some((GroupItem::Lost, state));
                    }
                }
                continue;
            };
            let next = tokio::time::timeout(SOURCE_SILENCE, current.next())
                .await
                .unwrap_or_else(|_| {
                    Some(Err(SourceError(rootcause::report!(
                        "the event source sent nothing for {} s",
                        SOURCE_SILENCE.as_secs()
                    ))))
                });
            match next {
                Some(Ok(SourceItem::Event(event))) => {
                    state.failures = 0;
                    if state.predates_stream(&event.event_id) {
                        continue;
                    }
                    state.last_event_id = Some(event.event_id.clone());
                    // The source applied the group's ids, so the entity id
                    // is not compared again.
                    if state.group.filter.matches(
                        &event.name,
                        "",
                        &event.envelope,
                        state.user.as_ref(),
                    ) {
                        return Some((GroupItem::Event(event), state));
                    }
                }
                Some(Ok(SourceItem::Heartbeat)) => {
                    state.failures = 0;
                    // The source sends its replay before any heartbeat, so
                    // what follows is live; a live event minted on a clock
                    // behind ours may predate the stream and is still wanted.
                    state.resumed = false;
                }
                Some(Err(error)) => {
                    tracing::warn!(error = ?error.0, "MCP events source failed");
                    state.current = None;
                    state.failures = state.failures.saturating_add(1);
                    return Some((GroupItem::Lost, state));
                }
                None => {
                    state.current = None;
                    state.failures = state.failures.saturating_add(1);
                    return Some((GroupItem::Lost, state));
                }
            }
        }
    })
    .boxed()
}

/// Doubling from [`FIRST_RETRY`] to [`MAX_RETRY`].
fn retry_delay(failures: u32) -> Duration {
    FIRST_RETRY
        .saturating_mul(2u32.saturating_pow(failures.saturating_sub(1)))
        .min(MAX_RETRY)
}

/// The most recent event ids, oldest forgotten first.
#[derive(Default)]
struct RecentIds {
    order: VecDeque<String>,
    seen: HashSet<String>,
}

impl RecentIds {
    /// Remember `id`; false when it was already remembered.
    fn insert(&mut self, id: &str) -> bool {
        if self.seen.contains(id) {
            return false;
        }
        if self.order.len() >= RECENT_EVENT_IDS
            && let Some(oldest) = self.order.pop_front()
        {
            self.seen.remove(&oldest);
        }
        self.order.push_back(id.to_owned());
        self.seen.insert(id.to_owned());
        true
    }
}
