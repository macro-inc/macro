//! Timer firings: the compaction debounce, the idle-eviction check, and the
//! persist retry.

use super::{DocMachine, IDLE_EVICT_MS, TimerKind};
use crate::model::{Effect, Outcome, TimerToken};
use crate::replica::Replica;

impl<R: Replica> DocMachine<R> {
    pub(super) fn on_timer(&mut self, token: TimerToken) -> Outcome {
        let Some(kind) = self.timers.remove(&token) else {
            return Outcome::quiet("timer already cancelled");
        };
        match kind {
            TimerKind::PersistDebounce => {
                self.persist_timer = None;
                Outcome::act(
                    "compaction debounce elapsed",
                    self.maybe_emit_persist_snapshot().into_iter().collect(),
                )
            }
            TimerKind::Idle => {
                self.idle_timer = None;
                if !self.peers.is_empty() {
                    return Outcome::quiet("idle timer stale: peers present");
                }
                if self.is_evictable() {
                    return Outcome::act("idle and clean; evicting", vec![Effect::Evict]);
                }
                // Dirty at idle: compact first, evict on the next tick.
                let mut out = Vec::new();
                out.extend(self.maybe_emit_persist_ops());
                out.extend(self.maybe_emit_persist_snapshot());
                let (token, effect) = self.schedule(TimerKind::Idle, IDLE_EVICT_MS);
                self.idle_timer = Some(token);
                out.push(effect);
                Outcome::act("idle but dirty; compacting before evict", out)
            }
            TimerKind::PersistRetry => {
                self.retry_timer = None;
                // A failed snapshot persist is retried by re-exporting fresh
                // state rather than resending stale bytes.
                Outcome::act(
                    "persist retry",
                    self.maybe_emit_persist_ops()
                        .into_iter()
                        .chain(self.maybe_emit_persist_snapshot())
                        .collect(),
                )
            }
        }
    }
}
