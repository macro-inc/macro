//! Where the trigger stream resumes, and which delivered events to act on.
//!
//! A resumed stream repeats some events around its cursor (replicas order
//! events differently, so the service looks back a little), and a stream
//! served by another replica may repeat what the last one delivered. Each
//! event is handled once.

use std::collections::{HashSet, VecDeque};
use std::time::SystemTime;

use crate::outbound::stream::cursor_at;
use crate::trigger::TriggerEvent;

#[cfg(test)]
mod test;

/// How many recent event ids are remembered to drop repeats: as many as the
/// service retains for replay, so no repeat it can send is ever handled twice.
const SEEN_EVENTS: usize = 4_096;

/// The trigger stream's position across reconnects.
pub(super) struct StreamPosition {
    /// The id the next stream resumes after.
    cursor: String,
    seen: HashSet<String>,
    seen_order: VecDeque<String>,
}

impl StreamPosition {
    /// A position for a daemon that started at `started`: the stream
    /// replays from then.
    pub(super) fn new(started: SystemTime) -> Self {
        Self {
            cursor: cursor_at(started),
            seen: HashSet::new(),
            seen_order: VecDeque::new(),
        }
    }

    /// The id the next stream resumes after.
    pub(super) fn cursor(&self) -> &str {
        &self.cursor
    }

    /// Advance past an event the stream delivered.
    pub(super) fn delivered(&mut self, id: &str) {
        id.clone_into(&mut self.cursor);
    }

    /// Whether to act on `event`: not one already handled.
    pub(super) fn admits(&mut self, event: &TriggerEvent) -> bool {
        let id = event.event_id.to_string();
        if self.seen.contains(&id) {
            tracing::debug!(event_id = %id, "repeated trigger event skipped");
            return false;
        }
        self.seen.insert(id.clone());
        self.seen_order.push_back(id);
        if self.seen_order.len() > SEEN_EVENTS
            && let Some(oldest) = self.seen_order.pop_front()
        {
            self.seen.remove(&oldest);
        }
        true
    }
}
