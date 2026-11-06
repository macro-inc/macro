//! Load completions: materialize the replica from the stored snapshot, replay
//! the already-durable op tail, then flush deferred initial syncs and frames.

use super::{DocMachine, Phase};
use crate::model::{CloseReason, Effect, Lifecycle, Outcome, ServerFrame};
use crate::replica::Replica;

impl<R: Replica> DocMachine<R> {
    pub(super) fn on_loaded(
        &mut self,
        snapshot: Option<Vec<u8>>,
        snapshot_seq: u64,
        ops: Vec<(u64, Vec<u8>)>,
    ) -> Outcome {
        if !matches!(self.phase, Phase::Loading { .. }) {
            // A completion for a load we no longer care about; ignore.
            return Outcome::quiet("stale load completion; ignored");
        }
        let Phase::Loading { queued } = std::mem::replace(&mut self.phase, Phase::Fresh) else {
            unreachable!("checked above");
        };

        let mut replica = match snapshot {
            Some(bytes) => match R::load(&bytes) {
                Ok(replica) => replica,
                Err(_) => {
                    self.phase = Phase::Broken;
                    return Outcome::act(
                        "stored snapshot unreadable; document broken",
                        self.close_all(CloseReason::LoadFailed),
                    );
                }
            },
            None => R::empty(),
        };

        // Replay the already-durable tail and resume numbering after it. The
        // replayed ops are NOT re-persisted (they came from the store) and
        // produce no blame or broadcasts.
        self.snapshot_seq = snapshot_seq;
        self.seq = snapshot_seq;
        let replayed = ops.len();
        for (seq, update) in ops {
            if replica.apply(&update).is_err() {
                // The store handed back an op the replica rejects: treat it
                // like an unreadable snapshot.
                self.phase = Phase::Broken;
                return Outcome::act(
                    "stored op unreadable; document broken",
                    self.close_all(CloseReason::LoadFailed),
                );
            }
            self.seq = seq;
        }
        self.persisted_seq = self.seq;
        let (snapshot, presence) = (replica.snapshot(), replica.presence_all());
        self.phase = Phase::Ready { replica };

        // Everyone who attached during the load gets their initial sync now.
        let synced = self.peers.len();
        let mut out: Vec<Effect> = self
            .peers
            .keys()
            .map(|&conn| Effect::Send {
                conn,
                frame: ServerFrame::InitialSync {
                    snapshot: snapshot.clone(),
                    presence: presence.clone(),
                },
            })
            .collect();

        // Replay frames that raced the load, in arrival order. Frame handling
        // never reports a lifecycle transition, so FirstJoin below stays the
        // only one this input can produce.
        for (conn, frame) in queued {
            // A conn may have detached while loading; skip its frames.
            if self.peers.contains_key(&conn) {
                out.extend(self.on_ready_frame(conn, frame).actions);
            }
        }

        let outcome = Outcome::act(
            format!("loaded; {synced} peers synced, {replayed} tail ops replayed"),
            out,
        );
        match synced > 0 {
            true => outcome.with_lifecycle(Lifecycle::FirstJoin),
            false => outcome,
        }
    }

    pub(super) fn on_load_failed(&mut self) -> Outcome {
        if !matches!(self.phase, Phase::Loading { .. }) {
            return Outcome::quiet("stale load failure; ignored");
        }
        self.phase = Phase::Broken;
        Outcome::act(
            "store load failed; document broken",
            self.close_all(CloseReason::LoadFailed),
        )
    }
}
