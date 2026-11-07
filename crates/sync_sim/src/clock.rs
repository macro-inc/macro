//! Ordered virtual scheduling. Every same-time choice consumes the world's RNG.
use crate::{ClientName, DocIx, Millis, ProfileName, TieMode};
use doc_sync_core::{SessionId, SyncInput};
use rand::Rng;
use std::collections::BTreeMap;

pub(crate) enum Pending {
    Wake(ClientName, SessionId, u64),
    Input(ClientName, SessionId, SyncInput),
    Storage(ProfileName, u64, i64),
    Connect(ClientName, SessionId, u32),
    Close(ClientName, SessionId, u32, u16),
    Up(ClientName, SessionId, u32, crate::network::Delivery),
    Down(ClientName, SessionId, u32, crate::network::Delivery),
    ServerReady(DocIx, u64),
    ServerDurable(DocIx, u64, u64, u64),
    Alarm(DocIx, u64),
    HealDirectory(DocIx),
    RouterWake(ProfileName, u64),
    RouterConnect(ProfileName, u32),
    RouterClose(ProfileName, u32, u16),
    RouterToken(
        ProfileName,
        doc_sync_core::SyncDocId,
        doc_sync_core::TokenEvent,
    ),
    RouteConnect(ProfileName, String, u64, String),
}
/// One virtual clock and stable/seeded ordered event queue.
pub struct SimClock {
    pub(crate) now: u64,
    pub(crate) wall_origin: i64,
    queue: BTreeMap<(u64, u64, u64), Pending>,
    next_seq: u64,
    ties: TieMode,
}
impl SimClock {
    /// Fixed 2026-01-01 wall origin, with monotonic time starting at zero.
    pub fn new(ties: TieMode) -> Self {
        Self {
            now: 0,
            wall_origin: 1_767_225_600_000,
            queue: BTreeMap::new(),
            next_seq: 0,
            ties,
        }
    }
    /// Current virtual monotonic time.
    pub fn now(&self) -> Millis {
        Millis(self.now)
    }
    /// Wall reading with an explicit client offset.
    pub fn wall(&self, skew: i64) -> i64 {
        self.wall_origin
            .saturating_add(i64::try_from(self.now).unwrap_or(i64::MAX))
            .saturating_add(skew)
    }
    pub(crate) fn schedule(&mut self, at: u64, event: Pending, rng: &mut impl Rng) {
        let order = match self.ties {
            TieMode::Fifo => self.next_seq,
            TieMode::Perturb => rng.random(),
        };
        self.queue
            .insert((at.max(self.now), order, self.next_seq), event);
        self.next_seq = self.next_seq.saturating_add(1);
    }
    pub(crate) fn pop(&mut self, through: u64) -> Option<Pending> {
        if self
            .queue
            .first_key_value()
            .is_none_or(|((at, _, _), _)| *at > through)
        {
            return None;
        }
        let ((at, _, _), event) = self.queue.pop_first()?;
        self.now = at;
        Some(event)
    }
    pub(crate) fn next_at(&self) -> Option<u64> {
        self.queue.first_key_value().map(|((at, _, _), _)| *at)
    }
    /// Work that must drain before settlement, excluding explicitly periodic traffic.
    /// Wake/alarm callbacks check state deadlines; core idleness and pending durable
    /// counters independently cover their outstanding non-periodic operations.
    pub(crate) fn has_non_periodic(&self) -> bool {
        self.queue.values().any(|event| match event {
            Pending::Wake(..) | Pending::RouterWake(..) | Pending::Alarm(..)
                | Pending::ServerDurable(..) => false,
            Pending::Up(_, _, _, delivery) | Pending::Down(_, _, _, delivery) => {
                delivery.corrupted || !matches!(delivery.kind,
                    crate::FrameKind::Awareness | crate::FrameKind::Ping | crate::FrameKind::Pong)
            }
            Pending::Input(_, _, input) => !matches!(input,
                SyncInput::Tick | SyncInput::SetPresence(_) |
                SyncInput::Chatter(doc_sync_core::ChatterMessage::Awareness(_))) &&
                !matches!(input, SyncInput::Socket { event: doc_sync_core::SocketEvent::Text(text), .. } if text == "pong"),
            Pending::Storage(..) | Pending::Connect(..) | Pending::Close(..)
                | Pending::ServerReady(..) | Pending::HealDirectory(..)
                | Pending::RouterConnect(..) | Pending::RouterClose(..)
                | Pending::RouterToken(..) | Pending::RouteConnect(..) => true,
        })
    }
    pub(crate) fn clear_client_wakes(&mut self, client: &ClientName) {
        self.queue
            .retain(|_, event| !matches!(event, Pending::Wake(name, _, _) if name == client));
    }
}
pub(crate) fn delay(range: (Millis, Millis), rng: &mut impl Rng) -> u64 {
    rng.random_range(range.0.0.min(range.1.0)..=range.0.0.max(range.1.0))
}
