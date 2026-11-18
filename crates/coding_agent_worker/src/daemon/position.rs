//! Where the trigger stream resumes, and which delivered events to act on.
//!
//! A resumed stream repeats some events around its cursor (replicas order
//! events differently, so the service looks back a little), and a stream
//! served by another replica may repeat what the last one delivered. Each
//! event is handled once, and never for an agent that was not yet bound to
//! this harness when the event was minted: that event was another runtime's.

use std::collections::{HashMap, HashSet, VecDeque};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

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
    /// When each bound agent was bound here, as near as this daemon can
    /// tell: when the last read of its agents that did not list it began.
    /// `None` for an agent already bound when the daemon started: nothing
    /// the stream delivers for it predates its binding.
    bound_since: HashMap<String, Option<SystemTime>>,
    /// Whether the bound agents have been read yet.
    read_once: bool,
    /// When the last read of the bound agents began.
    last_read: SystemTime,
    /// How far back the next stream must start for the agents newly bound
    /// since the last one: their triggers were filtered out of it however
    /// long before its last event they came.
    rewind_to: Option<SystemTime>,
}

impl StreamPosition {
    /// A position for a daemon that started at `started`: the stream
    /// replays from then, and agents bound then count as bound since.
    pub(super) fn new(started: SystemTime) -> Self {
        Self {
            cursor: cursor_at(started),
            seen: HashSet::new(),
            seen_order: VecDeque::new(),
            bound_since: HashMap::new(),
            read_once: false,
            last_read: started,
            rewind_to: None,
        }
    }

    /// Record a read of the bound agents that began at `read_at`. An agent
    /// listed for the first time was bound after the previous read began.
    pub(super) fn agents_read(&mut self, bots: &[String], read_at: SystemTime) {
        self.bound_since.retain(|bot, _| bots.contains(bot));
        if !self.read_once {
            // Bound before this daemon started. The start time is this
            // machine's clock, so it cannot date their events: one running
            // ahead of the service would skip a live mention.
            self.read_once = true;
            for bot in bots {
                self.bound_since.insert(bot.clone(), None);
            }
            self.last_read = read_at;
            return;
        }
        for bot in bots {
            if !self.bound_since.contains_key(bot) {
                self.bound_since.insert(bot.clone(), Some(self.last_read));
                self.rewind_to = Some(
                    self.rewind_to
                        .map_or(self.last_read, |rewind| rewind.min(self.last_read)),
                );
            }
        }
        self.last_read = read_at;
    }

    /// The id the next stream resumes after.
    #[cfg(test)]
    pub(super) fn cursor(&self) -> &str {
        &self.cursor
    }

    /// Where the next stream resumes: after the last event delivered, or
    /// earlier when agents were bound since, from when they were bound.
    pub(super) fn resume_cursor(&self) -> String {
        match (self.rewind_to, minted_at(&self.cursor)) {
            (Some(rewind), Some(delivered)) if rewind < delivered => cursor_at(rewind),
            _ => self.cursor.clone(),
        }
    }

    /// A stream opened from [`Self::resume_cursor`]; it covers the agents
    /// bound since, so later ones need not rewind for them. Until a stream
    /// opens, every attempt rewinds.
    pub(super) fn opened(&mut self) {
        self.rewind_to = None;
    }

    /// Advance past an event the stream delivered. A rewound stream
    /// delivers older events again; those never move the cursor back.
    pub(super) fn delivered(&mut self, id: &str) {
        if minted_at(id) >= minted_at(&self.cursor) {
            id.clone_into(&mut self.cursor);
        }
    }

    /// Whether to act on `event`: not one already handled, nor one minted
    /// before its agent was bound here.
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
        let bound_since = event
            .event
            .bot_id()
            .and_then(|bot| self.bound_since.get(&bot.to_string()).copied())
            .flatten();
        let minted = minted_at(&event.event_id.to_string());
        if let (Some(since), Some(minted)) = (bound_since, minted)
            && minted < since
        {
            tracing::debug!(
                event_id = %event.event_id,
                "trigger event from before its agent was bound here skipped"
            );
            return false;
        }
        true
    }
}

/// When the UUIDv7 `id` was minted.
fn minted_at(id: &str) -> Option<SystemTime> {
    let timestamp = macro_uuid::Uuid::parse_str(id).ok()?.get_timestamp()?;
    let (seconds, nanos) = timestamp.to_unix();
    Some(UNIX_EPOCH + Duration::new(seconds, nanos))
}
