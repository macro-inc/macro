//! Process-local bounded replay log for webhook event streams.

#[cfg(test)]
mod test;

use crate::domain::stream::{
    MAX_REPLAY_WINDOW, StreamCandidateEvent, StreamStart, WebhookStreamCandidateSink,
    WebhookStreamSource, WebhookStreamSourceFactory, WebhookStreamSourceOpenError,
};
use std::collections::{HashSet, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::Notify;

/// Hard event-count bound for the process-local replay log.
const MAX_REPLAY_EVENTS: usize = 100_000;
/// Approximate aggregate payload bound for the process-local replay log.
const MAX_REPLAY_BYTES: usize = 128 * 1024 * 1024;

struct BufferedCandidate {
    sequence: u64,
    inserted_at: Instant,
    approximate_bytes: usize,
    candidate: StreamCandidateEvent,
}

struct ReplayBuffer {
    events: VecDeque<BufferedCandidate>,
    event_ids: HashSet<String>,
    next_sequence: u64,
    approximate_bytes: usize,
    retention: Duration,
    generation: u64,
    healthy: bool,
    accepting: bool,
}

impl ReplayBuffer {
    fn new(retention: Duration) -> Self {
        Self {
            events: VecDeque::new(),
            event_ids: HashSet::new(),
            next_sequence: 0,
            approximate_bytes: 0,
            retention,
            generation: 0,
            healthy: false,
            accepting: false,
        }
    }

    fn begin_loading(&mut self) {
        self.accepting = false;
    }

    fn mark_ready(&mut self) {
        self.healthy = true;
        self.accepting = true;
    }

    fn mark_unavailable(&mut self) {
        self.healthy = false;
        self.accepting = false;
        self.generation = self.generation.wrapping_add(1);
    }

    fn push(&mut self, candidate: StreamCandidateEvent, now: Instant) -> bool {
        if self.event_ids.contains(&candidate.event.event_id) {
            return false;
        }

        let approximate_bytes = approximate_candidate_bytes(&candidate);
        let event_id = candidate.event.event_id.clone();
        self.event_ids.insert(event_id);
        self.approximate_bytes = self.approximate_bytes.saturating_add(approximate_bytes);
        self.events.push_back(BufferedCandidate {
            sequence: self.next_sequence,
            inserted_at: now,
            approximate_bytes,
            candidate,
        });
        self.next_sequence = self.next_sequence.wrapping_add(1);
        self.prune(now);
        true
    }

    fn prune(&mut self, now: Instant) {
        while self.events.front().is_some_and(|event| {
            now.saturating_duration_since(event.inserted_at) > self.retention
                || self.events.len() > MAX_REPLAY_EVENTS
                || self.approximate_bytes > MAX_REPLAY_BYTES
        }) {
            let event = self.events.pop_front().expect("front event exists");
            self.event_ids.remove(&event.candidate.event.event_id);
            self.approximate_bytes = self
                .approximate_bytes
                .saturating_sub(event.approximate_bytes);
        }
    }
}

struct HubInner {
    replay: Mutex<ReplayBuffer>,
    changed: Notify,
}

/// Shared process-local source for replaying recent events and receiving live events.
#[derive(Clone)]
pub struct WebhookStreamHub {
    inner: Arc<HubInner>,
}

impl Default for WebhookStreamHub {
    fn default() -> Self {
        Self::new()
    }
}

impl WebhookStreamHub {
    /// Create a hub retaining the configured webhook replay window.
    pub fn new() -> Self {
        Self::with_retention(MAX_REPLAY_WINDOW)
    }

    fn with_retention(retention: Duration) -> Self {
        Self {
            inner: Arc::new(HubInner {
                replay: Mutex::new(ReplayBuffer::new(retention)),
                changed: Notify::new(),
            }),
        }
    }

    /// Mark the hub as loading or reconnecting its process-level source.
    pub fn begin_loading(&self) {
        self.inner
            .replay
            .lock()
            .expect("webhook stream replay buffer lock poisoned")
            .begin_loading();
    }

    /// Make the loaded history and live source available to new streams.
    pub fn mark_ready(&self) {
        self.inner
            .replay
            .lock()
            .expect("webhook stream replay buffer lock poisoned")
            .mark_ready();
    }

    /// Invalidate existing streams while the process-level source reconnects.
    pub fn mark_unavailable(&self) {
        self.inner
            .replay
            .lock()
            .expect("webhook stream replay buffer lock poisoned")
            .mark_unavailable();
        self.inner.changed.notify_waiters();
    }
}

impl WebhookStreamCandidateSink for WebhookStreamHub {
    fn begin_loading(&self) {
        WebhookStreamHub::begin_loading(self);
    }

    fn mark_ready(&self) {
        WebhookStreamHub::mark_ready(self);
    }

    fn publish(&self, candidate: StreamCandidateEvent) {
        let inserted = self
            .inner
            .replay
            .lock()
            .expect("webhook stream replay buffer lock poisoned")
            .push(candidate, Instant::now());
        if inserted {
            self.inner.changed.notify_waiters();
        }
    }
}

/// Cursor into the shared replay log.
pub struct HubWebhookStreamSource {
    hub: WebhookStreamHub,
    next_sequence: u64,
    generation: u64,
}

impl WebhookStreamSource for HubWebhookStreamSource {
    async fn next_event(&mut self) -> Result<StreamCandidateEvent, rootcause::Report> {
        loop {
            let changed = self.hub.inner.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            {
                let mut replay = self
                    .hub
                    .inner
                    .replay
                    .lock()
                    .expect("webhook stream replay buffer lock poisoned");
                replay.prune(Instant::now());
                if !replay.healthy || replay.generation != self.generation {
                    return Err(rootcause::report!(
                        "webhook event stream source unavailable"
                    ));
                }
                let first_sequence = replay
                    .events
                    .front()
                    .map_or(replay.next_sequence, |event| event.sequence);
                if self.next_sequence < first_sequence {
                    return Err(rootcause::report!(
                        "webhook event stream cursor fell behind retained history"
                    ));
                }
                if let Some(index) = self.next_sequence.checked_sub(first_sequence)
                    && let Ok(index) = usize::try_from(index)
                    && let Some(buffered) = replay.events.get(index)
                {
                    self.next_sequence = self.next_sequence.wrapping_add(1);
                    return Ok(buffered.candidate.clone());
                }
            }
            changed.await;
        }
    }
}

impl WebhookStreamSourceFactory for WebhookStreamHub {
    type Source = HubWebhookStreamSource;

    async fn open(&self, start: StreamStart) -> Result<Self::Source, WebhookStreamSourceOpenError> {
        let mut replay = self
            .inner
            .replay
            .lock()
            .expect("webhook stream replay buffer lock poisoned");
        replay.prune(Instant::now());
        if !replay.accepting {
            return Err(WebhookStreamSourceOpenError::Unavailable);
        }

        let next_sequence = match start {
            StreamStart::Latest => replay.next_sequence,
            StreamStart::AtEvent { event_id } => {
                if !replay.event_ids.contains(&event_id.to_string()) {
                    return Err(WebhookStreamSourceOpenError::ReplayUnavailable);
                }
                replay
                    .events
                    .front()
                    .map_or(replay.next_sequence, |event| event.sequence)
            }
        };

        Ok(HubWebhookStreamSource {
            hub: self.clone(),
            next_sequence,
            generation: replay.generation,
        })
    }
}

fn approximate_candidate_bytes(candidate: &StreamCandidateEvent) -> usize {
    candidate.event.event_id.len()
        + candidate.event.event_name.len()
        + candidate.event.entity_type.len()
        + candidate.event.entity_id.len()
        + candidate.event.ordering_key.len()
        + serde_json::to_vec(&candidate.event.broker_envelope).map_or(0, |value| value.len())
}
