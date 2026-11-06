//! Persistence: emitting op-log appends and snapshot compactions, and the
//! completions that release acks and broadcasts (apply → persist → ack →
//! broadcast).

use super::{DocMachine, PERSIST_RETRY_MS, Phase, TimerKind};
use crate::model::{Effect, Lifecycle, Outcome, PersistToken, ServerFrame};
use crate::replica::Replica;

impl<R: Replica> DocMachine<R> {
    pub(super) fn on_ops_persisted(&mut self, token: PersistToken, through_seq: u64) -> Outcome {
        if self.inflight_ops.map(|(t, _)| t) != Some(token) {
            return Outcome::quiet("stale ops-persist completion; ignored");
        }
        self.inflight_ops = None;
        let previous = self.persisted_seq;
        self.persisted_seq = self.persisted_seq.max(through_seq);

        let mut out = Vec::new();
        // Release every ack the new watermark covers, in order. Acks before
        // broadcasts, matching the service today.
        while let Some(ack) = self.pending_acks.front() {
            if ack.through_seq > self.persisted_seq {
                break;
            }
            let ack = self.pending_acks.pop_front().expect("front checked");
            // The conn may have detached since; sending to a gone conn is the
            // runtime's no-op, not ours.
            out.push(Effect::Send {
                conn: ack.conn,
                frame: ServerFrame::Ack { id: ack.id },
            });
        }

        // Broadcast the newly durable ops to everyone but their authors.
        for entry in &self.op_tail {
            if entry.seq > previous && entry.seq <= self.persisted_seq {
                out.push(Effect::Broadcast {
                    except: entry.author,
                    frame: ServerFrame::Update {
                        update: entry.update.clone(),
                    },
                });
            }
        }

        // More ops arrived while this request was in flight.
        out.extend(self.maybe_emit_persist_ops());
        Outcome::act("ops durable; acks and broadcasts released", out)
    }

    pub(super) fn on_snapshot_persisted(&mut self, token: PersistToken) -> Outcome {
        let Some((inflight, through_seq)) = self.inflight_snapshot else {
            return Outcome::quiet("stale snapshot completion; ignored");
        };
        if inflight != token {
            return Outcome::quiet("stale snapshot completion; ignored");
        }
        self.inflight_snapshot = None;
        self.snapshot_seq = self.snapshot_seq.max(through_seq);
        // Ops covered by the snapshot are no longer needed for retry.
        while self
            .op_tail
            .front()
            .is_some_and(|entry| entry.seq <= self.snapshot_seq)
        {
            self.op_tail.pop_front();
        }
        // If everyone left while the compaction was in flight, we may be
        // clean now; the idle timer (already armed at LastLeave) will evict.
        Outcome::quiet("snapshot durable; op tail trimmed").with_lifecycle(Lifecycle::Edited)
    }

    pub(super) fn on_persist_failed(&mut self, token: PersistToken) -> Outcome {
        let failed_ops = self.inflight_ops.map(|(t, _)| t) == Some(token);
        let failed_snapshot = self.inflight_snapshot.map(|(t, _)| t) == Some(token);
        if !failed_ops && !failed_snapshot {
            return Outcome::quiet("stale persist failure; ignored");
        }
        if failed_ops {
            self.inflight_ops = None;
        }
        if failed_snapshot {
            self.inflight_snapshot = None;
        }
        // Keep pending acks: if the retry succeeds the acks flow late, which
        // clients treat as a no-op after their own timeout has fired.
        if self.retry_timer.is_some() {
            return Outcome::quiet("persist failed; retry already armed");
        }
        let (token, effect) = self.schedule(TimerKind::PersistRetry, PERSIST_RETRY_MS);
        self.retry_timer = Some(token);
        Outcome::act("persist failed; retry armed", vec![effect])
    }

    /// A `PersistOps` for the unpersisted tail, if any and none in flight.
    pub(super) fn maybe_emit_persist_ops(&mut self) -> Option<Effect> {
        if self.inflight_ops.is_some() || self.persisted_seq >= self.seq {
            return None;
        }
        let ops: Vec<(u64, Vec<u8>)> = self
            .op_tail
            .iter()
            .filter(|entry| entry.seq > self.persisted_seq)
            .map(|entry| (entry.seq, entry.update.clone()))
            .collect();
        let through_seq = ops.last()?.0;
        let token = self.next_persist_token();
        self.inflight_ops = Some((token, through_seq));
        Some(Effect::PersistOps {
            token,
            ops,
            through_seq,
        })
    }

    /// A `PersistSnapshot` if the replica has changes no snapshot covers and
    /// none is in flight.
    pub(super) fn maybe_emit_persist_snapshot(&mut self) -> Option<Effect> {
        if self.inflight_snapshot.is_some() || self.seq == self.snapshot_seq {
            return None;
        }
        let Phase::Ready { replica } = &self.phase else {
            return None;
        };
        let snapshot = replica.snapshot();
        let token = self.next_persist_token();
        self.inflight_snapshot = Some((token, self.seq));
        Some(Effect::PersistSnapshot {
            token,
            snapshot,
            through_seq: self.seq,
        })
    }
}
