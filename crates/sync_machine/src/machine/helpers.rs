//! Small helpers shared across the behavior submodules.

#[cfg(test)]
use super::Phase;
use super::{DocMachine, TimerKind};
use crate::model::{CloseReason, ConnId, Effect, PersistToken, TimerToken};
use crate::replica::Replica;

impl<R: Replica> DocMachine<R> {
    /// Close every attached connection and forget them.
    pub(super) fn close_all(&mut self, reason: CloseReason) -> Vec<Effect> {
        let closes = self
            .peers
            .keys()
            .map(|&conn: &ConnId| Effect::Close { conn, reason })
            .collect();
        self.peers.clear();
        closes
    }

    /// Cancel a pending idle eviction, if one is armed. The runtime may still
    /// fire the timer; the token is forgotten, so the firing is ignored.
    pub(super) fn clear_idle_timer(&mut self) {
        if let Some(token) = self.idle_timer.take() {
            self.timers.remove(&token);
        }
    }

    /// Register a timer; the returned effect asks the runtime to arm it.
    pub(super) fn schedule(&mut self, kind: TimerKind, after_ms: u64) -> (TimerToken, Effect) {
        self.next_token += 1;
        let token = TimerToken(self.next_token);
        self.timers.insert(token, kind);
        (token, Effect::ScheduleTimer { token, after_ms })
    }

    /// A fresh token for a persistence request.
    pub(super) fn next_persist_token(&mut self) -> PersistToken {
        self.next_token += 1;
        PersistToken(self.next_token)
    }

    /// Test-only access to the live replica.
    #[cfg(test)]
    pub(crate) fn replica(&self) -> Option<&R> {
        match &self.phase {
            Phase::Ready { replica } => Some(replica),
            _ => None,
        }
    }
}
