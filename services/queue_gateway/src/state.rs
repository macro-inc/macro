//! One queue's semantics: what SQS tracks for each message, without Kafka or HTTP.
//!
//! A record is held here from the moment it is consumed until it is deleted. Its
//! offset is committed only when every earlier offset in its partition is done, so
//! a crash redelivers everything unacknowledged.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How long a FIFO deduplication id suppresses repeats, as on SQS.
const DEDUP_WINDOW_MS: u64 = 5 * 60 * 1000;
/// SQS's default visibility timeout.
pub const DEFAULT_VISIBILITY_SECONDS: u64 = 30;

/// What a Kafka record holds.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Envelope {
    pub message_id: String,
    pub body: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attributes: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dedup: Option<String>,
    /// The sender's W3C trace context. SQS clients do not carry one to receivers, so the
    /// gateway records it on delivery to keep the flow findable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traceparent: Option<String>,
    pub sent_ms: u64,
    /// Not delivered before this time (`DelaySeconds`).
    pub not_before_ms: u64,
}

/// A message's position in Kafka.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct Position {
    pub partition: i32,
    pub offset: i64,
}

/// Commit `next_offset` on `partition`: everything before it is done.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Commit {
    pub partition: i32,
    pub next_offset: i64,
}

#[derive(Clone, Debug)]
struct Held {
    position: Position,
    envelope: Envelope,
    receive_count: u32,
    first_received_ms: Option<u64>,
}

#[derive(Clone, Debug)]
struct InFlight {
    held: Held,
    visible_at_ms: u64,
}

/// A message handed to a receiver.
#[derive(Clone, Debug, PartialEq)]
pub struct Delivery {
    pub receipt_handle: String,
    pub envelope: Envelope,
    pub receive_count: u32,
    pub first_received_ms: u64,
}

/// Dead-letter redrive settings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Redrive {
    pub dead_letter_queue: String,
    pub max_receive_count: u32,
}

/// Queue settings, persisted so they survive a restart.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    pub visibility_seconds: u64,
    pub delay_seconds: u64,
    pub content_based_dedup: bool,
    pub redrive: Option<Redrive>,
    /// Attributes returned as given, for callers that read back what they set.
    pub raw: BTreeMap<String, String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            visibility_seconds: DEFAULT_VISIBILITY_SECONDS,
            delay_seconds: 0,
            content_based_dedup: false,
            redrive: None,
            raw: BTreeMap::new(),
        }
    }
}

/// A message that exhausted its receives, to republish to its dead-letter queue.
#[derive(Clone, Debug, PartialEq)]
pub struct DeadLetter {
    pub queue: String,
    pub envelope: Envelope,
    pub position: Position,
}

/// Counts for `GetQueueAttributes`.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Depth {
    pub visible: usize,
    pub in_flight: usize,
    pub delayed: usize,
}

#[derive(Debug)]
pub struct QueueState {
    pub name: String,
    pub settings: Settings,
    ready: VecDeque<Held>,
    in_flight: HashMap<String, InFlight>,
    /// Offsets not yet done, per partition.
    outstanding: BTreeMap<i32, BTreeSet<i64>>,
    /// The highest offset consumed, per partition.
    consumed: BTreeMap<i32, i64>,
    /// The offset last reported for commit, per partition.
    committed: BTreeMap<i32, i64>,
    dedup_seen: HashMap<String, u64>,
    next_handle: u64,
}

impl QueueState {
    pub fn new(name: String, settings: Settings) -> Self {
        Self {
            name,
            settings,
            ready: VecDeque::new(),
            in_flight: HashMap::new(),
            outstanding: BTreeMap::new(),
            consumed: BTreeMap::new(),
            committed: BTreeMap::new(),
            dedup_seen: HashMap::new(),
            next_handle: 0,
        }
    }

    pub fn is_fifo(&self) -> bool {
        self.name.ends_with(".fifo")
    }

    /// Records a send's deduplication id. False when it repeats one in the window.
    pub fn first_send(&mut self, dedup: &str, now_ms: u64) -> bool {
        self.dedup_seen
            .retain(|_, seen| now_ms.saturating_sub(*seen) < DEDUP_WINDOW_MS);
        if self.dedup_seen.contains_key(dedup) {
            return false;
        }
        self.dedup_seen.insert(dedup.to_owned(), now_ms);
        true
    }

    /// Lets a deduplication id be sent again, after a send that did not reach Kafka.
    pub fn forget_send(&mut self, dedup: &str) {
        self.dedup_seen.remove(dedup);
    }

    /// Holds a record consumed from Kafka.
    pub fn ingest(&mut self, position: Position, envelope: Envelope) {
        self.outstanding
            .entry(position.partition)
            .or_default()
            .insert(position.offset);
        let consumed = self.consumed.entry(position.partition).or_insert(-1);
        *consumed = (*consumed).max(position.offset);
        self.ready.push_back(Held {
            position,
            envelope,
            receive_count: 0,
            first_received_ms: None,
        });
    }

    /// Hands out up to `max` messages, invisible to others for `visibility_seconds`.
    pub fn receive(&mut self, max: usize, visibility_seconds: u64, now_ms: u64) -> Vec<Delivery> {
        let mut busy_groups: HashSet<String> = self
            .in_flight
            .values()
            .filter_map(|m| m.held.envelope.group.clone())
            .collect();
        let fifo = self.is_fifo();
        let mut deliveries = Vec::new();
        let mut index = 0;
        while index < self.ready.len() && deliveries.len() < max {
            let message = &self.ready[index];
            let due = message.envelope.not_before_ms <= now_ms;
            let group = message.envelope.group.clone();
            let blocked = fifo && group.as_ref().is_some_and(|g| busy_groups.contains(g));
            if !due || blocked {
                // A FIFO group's later messages wait behind one that cannot go yet.
                if fifo && let Some(group) = group {
                    busy_groups.insert(group);
                }
                index += 1;
                continue;
            }
            let Some(mut held) = self.ready.remove(index) else {
                break;
            };
            if fifo && let Some(group) = group {
                // One message per group per receive keeps a group's order simple.
                busy_groups.insert(group);
            }
            held.receive_count += 1;
            let first_received_ms = *held.first_received_ms.get_or_insert(now_ms);
            self.next_handle += 1;
            let receipt_handle = format!(
                "{}:{}:{}",
                held.position.partition, held.position.offset, self.next_handle
            );
            deliveries.push(Delivery {
                receipt_handle: receipt_handle.clone(),
                envelope: held.envelope.clone(),
                receive_count: held.receive_count,
                first_received_ms,
            });
            self.in_flight.insert(
                receipt_handle,
                InFlight {
                    held,
                    visible_at_ms: now_ms + visibility_seconds * 1000,
                },
            );
        }
        deliveries
    }

    /// Acknowledges a message. A stale handle (already redelivered or deleted) is a
    /// no-op, as on SQS. Returns the commit it allows, if any.
    pub fn delete(&mut self, receipt_handle: &str) -> Option<Commit> {
        let in_flight = self.in_flight.remove(receipt_handle)?;
        self.finish(in_flight.held.position)
    }

    /// Changes when a message becomes visible again; zero returns it now. False when
    /// the handle is no longer current.
    pub fn change_visibility(&mut self, receipt_handle: &str, seconds: u64, now_ms: u64) -> bool {
        let Some(in_flight) = self.in_flight.get_mut(receipt_handle) else {
            return false;
        };
        in_flight.visible_at_ms = now_ms + seconds * 1000;
        true
    }

    /// Returns expired messages to the queue, in offset order. Those out of receives
    /// are moved out as dead letters; call [`Self::dead_lettered`] once each is
    /// republished, so a failed publish cannot lose it.
    pub fn expire(&mut self, now_ms: u64) -> Vec<DeadLetter> {
        let expired: Vec<String> = self
            .in_flight
            .iter()
            .filter(|(_, m)| m.visible_at_ms <= now_ms)
            .map(|(handle, _)| handle.clone())
            .collect();
        let mut returned = Vec::new();
        let mut dead = Vec::new();
        for handle in expired {
            let Some(in_flight) = self.in_flight.remove(&handle) else {
                continue;
            };
            let held = in_flight.held;
            match &self.settings.redrive {
                Some(redrive) if held.receive_count >= redrive.max_receive_count => {
                    dead.push(DeadLetter {
                        queue: redrive.dead_letter_queue.clone(),
                        envelope: held.envelope,
                        position: held.position,
                    });
                }
                _ => returned.push(held),
            }
        }
        returned.sort_by_key(|h| std::cmp::Reverse((h.position.partition, h.position.offset)));
        for held in returned {
            self.ready.push_front(held);
        }
        dead
    }

    /// Marks a dead letter done, now that its dead-letter queue has it.
    pub fn dead_lettered(&mut self, position: Position) -> Option<Commit> {
        self.finish(position)
    }

    /// Discards every message, in flight too, as SQS does. Returns the commits this
    /// allows.
    pub fn purge(&mut self) -> Vec<Commit> {
        let mut positions: Vec<Position> = self.ready.drain(..).map(|m| m.position).collect();
        positions.extend(self.in_flight.drain().map(|(_, m)| m.held.position));
        positions
            .into_iter()
            .filter_map(|position| self.finish(position))
            .collect()
    }

    pub fn depth(&self, now_ms: u64) -> Depth {
        let delayed = self
            .ready
            .iter()
            .filter(|m| m.envelope.not_before_ms > now_ms)
            .count();
        Depth {
            visible: self.ready.len() - delayed,
            in_flight: self.in_flight.len(),
            delayed,
        }
    }

    /// Everything held, for backpressure on the consumer.
    pub fn held(&self) -> usize {
        self.ready.len() + self.in_flight.len()
    }

    fn finish(&mut self, position: Position) -> Option<Commit> {
        let outstanding = self.outstanding.get_mut(&position.partition)?;
        outstanding.remove(&position.offset);
        let next_offset = match outstanding.first() {
            Some(lowest) => *lowest,
            None => *self.consumed.get(&position.partition)? + 1,
        };
        let committed = self.committed.entry(position.partition).or_insert(0);
        if next_offset <= *committed {
            return None;
        }
        *committed = next_offset;
        Some(Commit {
            partition: position.partition,
            next_offset,
        })
    }
}

#[cfg(test)]
mod test;
