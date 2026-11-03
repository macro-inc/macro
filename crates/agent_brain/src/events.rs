//! Macro's live event stream as a [`Stream`] of typed events.
//!
//! [`EventStream::stream`] holds `GET {storage}/webhook/events/stream` open,
//! reconnecting with exponential backoff whenever it drops. The server does
//! not replay missed events, so after every reconnect the stream yields
//! [`StreamItem::Reconnected`]: catch up then (for example with
//! [`MacroClient::channel_messages`] and `activity_after`).

use std::pin::Pin;
use std::time::Duration;

use chrono::{DateTime, Utc};
use eventsource_stream::Eventsource as _;
use futures::{Stream, StreamExt as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use crate::client::{MacroClient, Mention};
use crate::error::{Error, Result};

#[cfg(test)]
mod test;

/// The event name of a new message.
pub const MESSAGE_POSTED: &str = "message.posted";
/// The event name of a message that mentions the caller.
pub const MESSAGE_MENTIONED: &str = "message.mentioned";
/// The event name of users joining a channel.
pub const CHANNEL_PARTICIPANT_ADDED: &str = "channel.participant_added";

/// Which events to receive. A stream takes a list; an event matches if any
/// filter matches it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EventFilter {
    /// Event names, e.g. [`MESSAGE_POSTED`].
    pub events: Vec<String>,
    /// Only events about these entity ids (e.g. one channel).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ids: Option<Vec<String>>,
}

impl EventFilter {
    /// Every event with one of these names that the caller can see.
    pub fn events<I, S>(names: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            events: names.into_iter().map(Into::into).collect(),
            ids: None,
        }
    }

    /// Restrict to events about these entity ids.
    pub fn ids<I, S>(mut self, ids: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        self.ids = Some(ids.into_iter().map(Into::into).collect());
        self
    }
}

/// The author of a message: `macro|<email>` for users, `bot|<uuid>` for bots.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Sender(pub String);

impl Sender {
    /// Whether a bot (not a person or team agent) sent it.
    pub fn is_bot(&self) -> bool {
        self.0.starts_with("bot|")
    }

    /// The raw id string.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// What a message belongs to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageParent {
    /// `channel`, `document`, `call`, ...
    #[serde(rename = "type")]
    pub kind: String,
    /// The parent's id.
    pub id: String,
}

/// Metadata of `message.posted`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessagePosted {
    /// The new message's id.
    pub message_id: String,
    /// Macro Markdown body.
    pub content: String,
    /// When it was posted.
    pub created_at: DateTime<Utc>,
    /// Explicit mentions.
    #[serde(default)]
    pub mentions: Vec<Mention>,
    /// Attachments, as raw JSON.
    #[serde(default)]
    pub attachments: Vec<Value>,
    /// What the message belongs to.
    pub parent: MessageParent,
    /// The conversation's root message id, shared by the root and replies.
    pub root_id: String,
    /// The thread root for a reply; `None` for a new root.
    #[serde(default)]
    pub thread_id: Option<String>,
    /// The author.
    pub sender: Sender,
    /// For bot messages, the user whose action triggered it.
    #[serde(default)]
    pub triggered_by: Option<String>,
}

impl MessagePosted {
    /// The channel id, when the message is in a channel.
    pub fn channel_id(&self) -> Option<&str> {
        (self.parent.kind == "channel").then_some(self.parent.id.as_str())
    }

    /// Whether the message explicitly mentions this entity id.
    pub fn mentions(&self, entity_id: &str) -> bool {
        self.mentions.iter().any(|m| m.entity_id == entity_id)
    }

    /// Whether this is a reply in a thread.
    pub fn is_reply(&self) -> bool {
        self.thread_id.is_some()
    }
}

/// Metadata of `message.mentioned`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct MessageMentioned {
    /// The message's id.
    pub message_id: String,
    /// Macro Markdown body.
    pub content: String,
    /// When it was posted.
    pub created_at: DateTime<Utc>,
    /// Who was mentioned.
    pub mentioned: Mention,
    /// What the message belongs to.
    pub parent: MessageParent,
    /// The conversation's root message id.
    pub root_id: String,
    /// The author.
    pub sender: Sender,
    /// The thread root for a reply.
    #[serde(default)]
    pub thread_id: Option<String>,
}

/// Metadata of `channel.participant_added`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChannelParticipantAdded {
    /// Who added them.
    pub added_by: Sender,
    /// The users added.
    pub added_user_ids: Vec<String>,
    /// The channel.
    pub channel_id: String,
    /// The channel's kind.
    pub channel_type: String,
}

/// An event's payload, typed for the events this crate models and raw JSON
/// for the rest (see `packages/sdk` for every event name).
#[derive(Debug, Clone, PartialEq)]
pub enum EventKind {
    /// `message.posted`.
    MessagePosted(Box<MessagePosted>),
    /// `message.mentioned`.
    MessageMentioned(Box<MessageMentioned>),
    /// `channel.participant_added`.
    ChannelParticipantAdded(ChannelParticipantAdded),
    /// Any other event, or a modeled one whose payload did not decode.
    Other {
        /// The event name.
        event_type: String,
        /// The raw metadata.
        metadata: Value,
    },
}

/// One event from the stream.
#[derive(Debug, Clone, PartialEq)]
pub struct Event {
    /// Unique per delivery; use it to deduplicate.
    pub event_id: String,
    /// The event name, e.g. `message.posted`.
    pub event_type: String,
    /// The payload.
    pub kind: EventKind,
}

#[derive(Debug, Deserialize)]
struct Envelope {
    event_id: String,
    event_type: String,
    #[serde(default)]
    metadata: Value,
}

/// Decode one SSE `data` payload (the broker envelope).
pub fn parse_envelope(data: &str) -> Result<Event> {
    let envelope: Envelope =
        serde_json::from_str(data).map_err(|e| Error::json("an event envelope", e))?;
    fn typed<T: serde::de::DeserializeOwned>(metadata: &Value) -> Option<T> {
        T::deserialize(metadata).ok()
    }
    let metadata = envelope.metadata;
    let kind = match envelope.event_type.as_str() {
        MESSAGE_POSTED => typed(&metadata).map(|m| EventKind::MessagePosted(Box::new(m))),
        MESSAGE_MENTIONED => typed(&metadata).map(|m| EventKind::MessageMentioned(Box::new(m))),
        CHANNEL_PARTICIPANT_ADDED => typed(&metadata).map(EventKind::ChannelParticipantAdded),
        _ => None,
    }
    .unwrap_or_else(|| EventKind::Other {
        event_type: envelope.event_type.clone(),
        metadata,
    });
    Ok(Event {
        event_id: envelope.event_id,
        event_type: envelope.event_type,
        kind,
    })
}

/// What the stream yields.
#[derive(Debug, Clone, PartialEq)]
pub enum StreamItem {
    /// An event.
    Event(Event),
    /// The connection dropped and is back. Events published in between were
    /// lost; catch up on anything you care about.
    Reconnected {
        /// When the previous connection dropped.
        disconnected_at: DateTime<Utc>,
    },
}

/// Decode an SSE byte stream into events, skipping undecodable ones. The
/// stream ends when the bytes end or fail.
pub fn decode_sse<S, B, E>(bytes: S) -> impl Stream<Item = Event> + Send
where
    S: Stream<Item = std::result::Result<B, E>> + Send,
    B: AsRef<[u8]> + Send,
    E: std::fmt::Display + Send,
{
    bytes
        .eventsource()
        .take_while(|item| {
            let alive = match item {
                Ok(_) => true,
                Err(e) => {
                    tracing::warn!(error = %e, "event stream broke");
                    false
                }
            };
            futures::future::ready(alive)
        })
        .filter_map(|item| {
            let event = match item {
                Ok(sse) if !sse.data.trim().is_empty() => parse_envelope(&sse.data)
                    .inspect_err(|e| tracing::warn!(error = %e, sse_event = %sse.event, "skipping undecodable event"))
                    .ok(),
                _ => None,
            };
            futures::future::ready(event)
        })
}

/// Reconnect backoff for [`EventStream`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backoff {
    /// The first retry delay.
    pub initial: Duration,
    /// The longest delay between retries.
    pub max: Duration,
}

impl Default for Backoff {
    fn default() -> Self {
        Self {
            initial: Duration::from_secs(1),
            max: Duration::from_secs(60),
        }
    }
}

/// A reconnecting subscription to Macro events as the client's user.
#[derive(Debug, Clone)]
pub struct EventStream {
    client: MacroClient,
    filters: Vec<EventFilter>,
    backoff: Backoff,
}

type Events = Pin<Box<dyn Stream<Item = Event> + Send>>;

struct State {
    client: MacroClient,
    filters_json: String,
    backoff: Backoff,
    delay: Duration,
    cancel: CancellationToken,
    events: Option<Events>,
    connected_before: bool,
    disconnected_at: Option<DateTime<Utc>>,
}

impl EventStream {
    /// A subscription to events matching any of `filters`.
    pub fn new(client: MacroClient, filters: Vec<EventFilter>) -> Self {
        Self {
            client,
            filters,
            backoff: Backoff::default(),
        }
    }

    /// Use a different reconnect backoff.
    pub fn with_backoff(mut self, backoff: Backoff) -> Self {
        self.backoff = backoff;
        self
    }

    /// Start streaming. Never ends on its own: it reconnects until `cancel`
    /// fires, then ends.
    pub fn stream(
        self,
        cancel: CancellationToken,
    ) -> Result<impl Stream<Item = StreamItem> + Send> {
        if self.filters.is_empty() {
            return Err(Error::Config(
                "an event stream needs at least one filter".to_owned(),
            ));
        }
        let filters_json = serde_json::to_string(&self.filters)
            .map_err(|e| Error::json("the event filters", e))?;
        let state = State {
            client: self.client,
            filters_json,
            backoff: self.backoff,
            delay: self.backoff.initial,
            cancel,
            events: None,
            connected_before: false,
            disconnected_at: None,
        };
        Ok(futures::stream::unfold(state, next_item))
    }
}

async fn next_item(mut state: State) -> Option<(StreamItem, State)> {
    loop {
        if state.cancel.is_cancelled() {
            return None;
        }
        let Some(events) = state.events.as_mut() else {
            let opened = tokio::select! {
                () = state.cancel.cancelled() => return None,
                opened = state.client.open_event_stream(&state.filters_json) => opened,
            };
            match opened {
                Ok(response) => {
                    tracing::info!("event stream connected");
                    state.events = Some(Box::pin(decode_sse(response.bytes_stream())));
                    let first = !std::mem::replace(&mut state.connected_before, true);
                    if !first {
                        let disconnected_at = state.disconnected_at.take().unwrap_or_else(Utc::now);
                        return Some((StreamItem::Reconnected { disconnected_at }, state));
                    }
                }
                Err(e) => {
                    tracing::warn!(error = %e, retry_in_ms = state.delay.as_millis() as u64, "event stream connect failed");
                    state.disconnected_at.get_or_insert_with(Utc::now);
                    tokio::select! {
                        () = state.cancel.cancelled() => return None,
                        () = tokio::time::sleep(state.delay) => {}
                    }
                    state.delay = (state.delay * 2).min(state.backoff.max);
                }
            }
            continue;
        };
        let next = tokio::select! {
            () = state.cancel.cancelled() => return None,
            next = events.next() => next,
        };
        match next {
            Some(event) => {
                state.delay = state.backoff.initial;
                tracing::debug!(event_id = %event.event_id, event_type = %event.event_type, "event received");
                return Some((StreamItem::Event(event), state));
            }
            None => {
                tracing::warn!(
                    retry_in_ms = state.delay.as_millis() as u64,
                    "event stream ended; reconnecting"
                );
                state.events = None;
                state.disconnected_at = Some(Utc::now());
                tokio::select! {
                    () = state.cancel.cancelled() => return None,
                    () = tokio::time::sleep(state.delay) => {}
                }
                state.delay = (state.delay * 2).min(state.backoff.max);
            }
        }
    }
}
