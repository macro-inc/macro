//! Attach and detach: peer membership, initial sync, and the FirstJoin /
//! LastLeave lifecycle edges.

use super::{DocMachine, IDLE_EVICT_MS, Peer, Phase, TimerKind};
use crate::model::{Capabilities, CloseReason, ConnId, Effect, Lifecycle, Outcome, ServerFrame};
use crate::replica::Replica;

impl<R: Replica> DocMachine<R> {
    pub(super) fn on_attached(&mut self, conn: ConnId, capabilities: Capabilities) -> Outcome {
        if let Phase::Broken = self.phase {
            return Outcome::act(
                "attach refused: document failed to load",
                vec![Effect::Close {
                    conn,
                    reason: CloseReason::LoadFailed,
                }],
            );
        }

        let first_join = self.peers.is_empty();
        self.peers.entry(conn).or_insert(Peer {
            capabilities,
            peer_ids: Vec::new(),
        });
        // Any attach cancels a pending idle eviction.
        self.clear_idle_timer();

        match &self.phase {
            Phase::Fresh => {
                self.phase = Phase::Loading { queued: Vec::new() };
                // Initial sync and FirstJoin are deferred to `Loaded`.
                Outcome::act("first attach; loading from store", vec![Effect::Load])
            }
            Phase::Loading { .. } => {
                // Deferred to `Loaded` alongside everyone else waiting.
                Outcome::quiet("attach deferred behind in-flight load")
            }
            Phase::Ready { replica } => {
                let outcome = Outcome::act(
                    "attached; sent initial sync",
                    vec![Effect::Send {
                        conn,
                        frame: ServerFrame::InitialSync {
                            snapshot: replica.snapshot(),
                            presence: replica.presence_all(),
                        },
                    }],
                );
                match first_join {
                    true => outcome.with_lifecycle(Lifecycle::FirstJoin),
                    false => outcome,
                }
            }
            Phase::Broken => unreachable!("handled above"),
        }
    }

    pub(super) fn on_detached(&mut self, conn: ConnId) -> Outcome {
        let Some(peer) = self.peers.remove(&conn) else {
            return Outcome::quiet("detach for unknown connection");
        };
        let mut out = Vec::new();
        if !peer.peer_ids.is_empty()
            && let Phase::Ready { replica } = &mut self.phase
            && let Some(delta) = replica.remove_presence(&peer.peer_ids)
        {
            out.push(Effect::Broadcast {
                except: conn,
                frame: ServerFrame::Presence { payload: delta },
            });
        }
        if self.peers.is_empty() {
            let (token, effect) = self.schedule(TimerKind::Idle, IDLE_EVICT_MS);
            self.idle_timer = Some(token);
            out.push(effect);
            return Outcome::act("last peer left; idle eviction armed", out)
                .with_lifecycle(Lifecycle::LastLeave);
        }
        Outcome::act("detached", out)
    }
}
