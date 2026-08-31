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
const MAX_REPLAY_EVENTS: usize = 50_000;

struct BufferedCandidate {
    sequence: u64,
    inserted_at: Instant,
    candidate: StreamCandidateEvent,
}

struct ReplayBuffer {
    events: VecDeque<BufferedCandidate>,
    event_ids: HashSet<String>,
    next_sequence: u64,
    retention: Duration,
}

impl ReplayBuffer {
    fn new(retention: Duration) -> Self {
        Self {
            events: VecDeque::new(),
            event_ids: HashSet::new(),
            next_sequence: 0,
            retention,
        }
    }

    fn push(&mut self, candidate: StreamCandidateEvent, now: Instant) -> bool {
        if self.event_ids.contains(&candidate.event.event_id) {
            return false;
        }

        let event_id = candidate.event.event_id.clone();
        self.event_ids.insert(event_id);
        self.events.push_back(BufferedCandidate {
            sequence: self.next_sequence,
            inserted_at: now,
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
        }) {
            let Some(event) = self.events.pop_front() else {
                break;
            };
            self.event_ids.remove(&event.candidate.event.event_id);
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
}

impl WebhookStreamCandidateSink for WebhookStreamHub {
    fn publish(&self, candidate: StreamCandidateEvent) {
        let inserted = self
            .inner
            .replay
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
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
}

impl WebhookStreamSource for HubWebhookStreamSource {
    async fn next_event(&mut self) -> Result<StreamCandidateEvent, rootcause::Report> {
        loop {
            let changed = self.hub.inner.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            {
                let mut replay = self.hub.inner.replay.lock().map_err(|_| {
                    rootcause::report!("webhook stream replay buffer lock poisoned")
                })?;
                replay.prune(Instant::now());
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
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        replay.prune(Instant::now());

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
        })
    }
}
