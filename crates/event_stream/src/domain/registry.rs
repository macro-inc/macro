//! The process' open streams, indexed for fan-out.
//!
//! Two indexes keep an event nobody local wants at one hash lookup: event
//! name (and family, and `*`) to streams, and bot to streams (for closing a
//! deleted bot's streams). Only the streams an index returns have their full
//! filters checked and their audience resolved.

use crate::domain::catalog::{self, ACCOUNT_HOLDER_FAMILIES};
use crate::domain::filters::{self, ALL_EVENTS, FilterSubject, WebhookFilters};
use crate::domain::models::{CloseReason, Cursor, NormalizedEvent, StreamPrincipal, WebhookScope};
use event_exposure::Stage;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

/// Events buffered per stream before it is closed as lagged.
pub const STREAM_BUFFER: usize = 1_024;

/// A stream's registration id, unique in the process.
pub type StreamId = u64;

/// One event handed to one stream.
#[derive(Debug, Clone)]
pub struct Delivery {
    /// The event's log position.
    pub cursor: Cursor,
    /// The event.
    pub event: Arc<NormalizedEvent>,
}

/// What a stream registers.
pub struct Registration {
    /// Who holds it.
    pub principal: Arc<StreamPrincipal>,
    /// Personal or team workspace.
    pub scope: WebhookScope,
    /// Its filters.
    pub filters: Arc<WebhookFilters>,
    /// Whether the holder has the `public-event-stream` flag: wildcards and
    /// preview events.
    pub preview: bool,
}

struct Entry {
    registration: Registration,
    sender: mpsc::Sender<Delivery>,
    close: Option<oneshot::Sender<CloseReason>>,
}

/// The receiving half of a registration.
pub struct Subscription {
    /// The stream's id.
    pub id: StreamId,
    /// Deliveries for the stream.
    pub deliveries: mpsc::Receiver<Delivery>,
    /// Fires once when the server closes the stream.
    pub closed: oneshot::Receiver<CloseReason>,
}

/// A stream whose filters accept an event.
pub struct Match {
    /// The stream.
    pub id: StreamId,
    /// Who holds it.
    pub principal: Arc<StreamPrincipal>,
    /// Personal or team workspace.
    pub scope: WebhookScope,
    /// Whether the holder has the `public-event-stream` flag.
    pub preview: bool,
}

#[derive(Default)]
struct Index {
    next_id: StreamId,
    streams: HashMap<StreamId, Entry>,
    by_event: HashMap<String, HashSet<StreamId>>,
    by_family: HashMap<String, HashSet<StreamId>>,
    all_events: HashSet<StreamId>,
    by_bot: HashMap<Uuid, HashSet<StreamId>>,
}

/// Open streams and their indexes.
#[derive(Default)]
pub struct Registry {
    index: Mutex<Index>,
}

/// Whether a stream held by `principal` may receive an event at all, before
/// its audience is resolved: preview events need the flag, and on flagged
/// streams only the account holder (or a bot they own) receives their own
/// webhook, bot and API key lifecycle; unflagged streams keep the original
/// rule (their workspace's events, whoever acts for it).
pub fn eligible(
    principal: &StreamPrincipal,
    preview: bool,
    event: &NormalizedEvent,
    stage: Stage,
) -> bool {
    if stage == Stage::Preview && !preview {
        return false;
    }
    let holder_family = filters::family(&event.event_name)
        .is_some_and(|family| ACCOUNT_HOLDER_FAMILIES.contains(&family));
    !(preview && holder_family) || principal.kind.is_account_holder()
}

impl Registry {
    /// Register a stream.
    pub fn register(&self, registration: Registration) -> Subscription {
        let (sender, deliveries) = mpsc::channel(STREAM_BUFFER);
        let (close, closed) = oneshot::channel();
        let mut index = self.lock();
        index.next_id += 1;
        let id = index.next_id;

        for filter in registration.filters.iter() {
            for pattern in &filter.events {
                if registration.preview && pattern == ALL_EVENTS {
                    index.all_events.insert(id);
                } else if let Some(family) = filters::wildcard_family(pattern)
                    && registration.preview
                {
                    index
                        .by_family
                        .entry(family.to_owned())
                        .or_default()
                        .insert(id);
                } else {
                    index
                        .by_event
                        .entry(pattern.clone())
                        .or_default()
                        .insert(id);
                }
            }
        }
        if let Some(bot_id) = registration.principal.kind.bot_id() {
            index.by_bot.entry(bot_id).or_default().insert(id);
        }
        index.streams.insert(
            id,
            Entry {
                registration,
                sender,
                close: Some(close),
            },
        );

        Subscription {
            id,
            deliveries,
            closed,
        }
    }

    /// Remove a stream. Idempotent.
    pub fn deregister(&self, id: StreamId) {
        let mut index = self.lock();
        let Some(entry) = index.streams.remove(&id) else {
            return;
        };
        for filter in entry.registration.filters.iter() {
            for pattern in &filter.events {
                remove_from(&mut index.by_event, pattern, id);
                if let Some(family) = filters::wildcard_family(pattern) {
                    remove_from(&mut index.by_family, family, id);
                }
            }
        }
        index.all_events.remove(&id);
        if let Some(bot_id) = entry.registration.principal.kind.bot_id() {
            remove_from(&mut index.by_bot, &bot_id, id);
        }
    }

    /// Open streams.
    pub fn len(&self) -> usize {
        self.lock().streams.len()
    }

    /// Whether no stream is open.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Streams whose filters accept the event and which may receive it.
    pub fn matching(&self, event: &NormalizedEvent, stage: Stage) -> Vec<Match> {
        let index = self.lock();
        let mut ids: HashSet<StreamId> = HashSet::new();
        if let Some(streams) = index.by_event.get(&event.event_name) {
            ids.extend(streams);
        }
        if catalog::is_public_event(&event.event_name) {
            if let Some(family) = filters::family(&event.event_name)
                && let Some(streams) = index.by_family.get(family)
            {
                ids.extend(streams);
            }
            ids.extend(&index.all_events);
        }

        let subject = FilterSubject {
            event_name: &event.event_name,
            entity_type: &event.entity_type,
            entity_id: &event.entity_id,
        };
        ids.into_iter()
            .filter_map(|id| {
                let registration = &index.streams.get(&id)?.registration;
                if !filters::any_accepts(&registration.filters, subject, registration.preview) {
                    return None;
                }
                if !eligible(&registration.principal, registration.preview, event, stage) {
                    return None;
                }
                Some(Match {
                    id,
                    principal: registration.principal.clone(),
                    scope: registration.scope,
                    preview: registration.preview,
                })
            })
            .collect()
    }

    /// Hand an event to a stream. A full buffer closes the stream as lagged;
    /// a stream whose task ended is removed.
    pub fn deliver(&self, id: StreamId, delivery: Delivery) -> bool {
        let mut index = self.lock();
        let Some(entry) = index.streams.get_mut(&id) else {
            return false;
        };
        match entry.sender.try_send(delivery) {
            Ok(()) => true,
            // A flagged stream closes as lagged and resumes from its cursor.
            // An unflagged one has no cursor: it skips the event and carries
            // on, as streams did before.
            Err(mpsc::error::TrySendError::Full(_)) if entry.registration.preview => {
                close_entry(entry, CloseReason::Lagged);
                false
            }
            Err(mpsc::error::TrySendError::Full(_)) => {
                tracing::warn!(
                    stream.id = id,
                    "an unflagged event stream is behind; skipping an event"
                );
                false
            }
            Err(mpsc::error::TrySendError::Closed(_)) => false,
        }
    }

    /// Close one stream.
    pub fn close(&self, id: StreamId, reason: CloseReason) {
        if let Some(entry) = self.lock().streams.get_mut(&id) {
            close_entry(entry, reason);
        }
    }

    /// Close every stream a bot holds.
    pub fn close_bot(&self, bot_id: Uuid, reason: CloseReason) -> usize {
        let mut index = self.lock();
        let ids: Vec<StreamId> = index
            .by_bot
            .get(&bot_id)
            .map(|ids| ids.iter().copied().collect())
            .unwrap_or_default();
        // Closing a deleted bot's streams is new: flagged streams only.
        let mut closed = 0;
        for id in &ids {
            if let Some(entry) = index.streams.get_mut(id)
                && entry.registration.preview
            {
                close_entry(entry, reason);
                closed += 1;
            }
        }
        closed
    }

    /// Close every stream.
    pub fn close_all(&self, reason: CloseReason) {
        for entry in self.lock().streams.values_mut() {
            close_entry(entry, reason);
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Index> {
        self.index
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
    }
}

fn close_entry(entry: &mut Entry, reason: CloseReason) {
    if let Some(close) = entry.close.take() {
        let _ = close.send(reason);
    }
}

fn remove_from<K, Q>(map: &mut HashMap<K, HashSet<StreamId>>, key: &Q, id: StreamId)
where
    K: std::borrow::Borrow<Q> + std::hash::Hash + Eq,
    Q: std::hash::Hash + Eq + ?Sized,
{
    if let Some(ids) = map.get_mut(key) {
        ids.remove(&id);
        if ids.is_empty() {
            map.remove(key);
        }
    }
}
