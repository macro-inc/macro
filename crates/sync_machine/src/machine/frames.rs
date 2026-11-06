//! Client frames: updates (apply → persist → ack → broadcast), presence,
//! catch-up requests, snapshot requests, and peer-id registration.

use super::{DocMachine, OpEntry, PERSIST_DEBOUNCE_MS, PendingAck, Phase, TimerKind};
use crate::model::{BlameEvent, ClientFrame, CloseReason, ConnId, Effect, Outcome, ServerFrame};
use crate::replica::Replica;
use std::borrow::Cow;

impl<R: Replica> DocMachine<R> {
    pub(super) fn on_frame(&mut self, conn: ConnId, frame: ClientFrame) -> Outcome {
        if !self.peers.contains_key(&conn) {
            return Outcome::act(
                "frame from unattached connection; closing",
                vec![Effect::Close {
                    conn,
                    reason: CloseReason::NotAttached,
                }],
            );
        }
        match &mut self.phase {
            Phase::Fresh | Phase::Broken => {
                // Fresh is unreachable for an attached conn; Broken conns were
                // closed at attach. Drop defensively.
                Outcome::quiet("frame dropped: document not live")
            }
            Phase::Loading { queued } => {
                queued.push((conn, frame));
                Outcome::quiet("frame queued behind load")
            }
            Phase::Ready { .. } => self.on_ready_frame(conn, frame),
        }
    }

    pub(super) fn on_ready_frame(&mut self, conn: ConnId, frame: ClientFrame) -> Outcome {
        match frame {
            ClientFrame::Update { updates, id } => self.on_update(conn, updates, id),
            ClientFrame::Presence { payload } => {
                if let Phase::Ready { replica } = &mut self.phase {
                    replica.apply_presence(&payload);
                }
                Outcome::act(
                    "presence applied and broadcast",
                    vec![Effect::Broadcast {
                        except: conn,
                        frame: ServerFrame::Presence { payload },
                    }],
                )
            }
            ClientFrame::RequestSince { cursor } => {
                let Phase::Ready { replica } = &self.phase else {
                    unreachable!("on_ready_frame is only called in Ready");
                };
                match replica.diff_since(&cursor) {
                    Ok(update) => Outcome::act(
                        "sent catch-up diff",
                        vec![Effect::Send {
                            conn,
                            frame: ServerFrame::Since { update, cursor },
                        }],
                    ),
                    Err(_) => Outcome::act(
                        "unreadable catch-up cursor; closing",
                        vec![Effect::Close {
                            conn,
                            reason: CloseReason::Protocol,
                        }],
                    ),
                }
            }
            ClientFrame::RequestSnapshot => {
                let Phase::Ready { replica } = &self.phase else {
                    unreachable!("on_ready_frame is only called in Ready");
                };
                Outcome::act(
                    "sent snapshot",
                    vec![Effect::Send {
                        conn,
                        frame: ServerFrame::Snapshot {
                            snapshot: replica.snapshot(),
                        },
                    }],
                )
            }
            ClientFrame::RegisterPeer { peer_id } => {
                let Some(peer) = self.peers.get_mut(&conn) else {
                    return Outcome::quiet("peer registration for unknown connection");
                };
                if peer.peer_ids.contains(&peer_id) {
                    return Outcome::quiet("peer id already registered");
                }
                peer.peer_ids.push(peer_id);
                let actions = match peer.capabilities.user_id.clone() {
                    Some(user_id) => vec![Effect::RecordPeerMapping { peer_id, user_id }],
                    None => Vec::new(),
                };
                Outcome::act("peer id registered", actions)
            }
        }
    }

    fn on_update(&mut self, conn: ConnId, updates: Vec<Vec<u8>>, id: String) -> Outcome {
        let Some(peer) = self.peers.get(&conn) else {
            return Outcome::quiet("update from unknown connection");
        };
        if !peer.capabilities.can_edit {
            // Drop (the client's ack timeout surfaces it). Not a Close so that
            // view-only tabs shouldn't be disconnected for a stray keystroke
            // race.
            return Outcome::quiet("update dropped: connection cannot edit");
        }
        let author_peer_id = peer.peer_ids.first().copied();

        let Phase::Ready { replica } = &mut self.phase else {
            unreachable!("on_ready_frame is only called in Ready");
        };

        let mut blame: Vec<BlameEvent> = Vec::new();
        let mut applied = 0usize;
        let mut poisoned = false;
        for update in updates {
            match replica.apply(&update) {
                Ok(result) => {
                    // Apply first, THEN assign the sequence: any op holding a
                    // seq is already in the replica, so a snapshot taken at
                    // any later watermark necessarily contains it.
                    self.seq += 1;
                    self.op_tail.push_back(OpEntry {
                        seq: self.seq,
                        update,
                        author: conn,
                    });
                    if let Some(peer_id) = author_peer_id {
                        blame.extend(
                            result
                                .touched_nodes
                                .into_iter()
                                .map(|node_id| BlameEvent { node_id, peer_id }),
                        );
                    }
                    applied += 1;
                }
                Err(_) => {
                    // Poison never reaches the log or the peers. Ops applied
                    // earlier in the batch stand (they're already in the
                    // replica), matching the service's abort-on-error today.
                    poisoned = true;
                    break;
                }
            }
        }

        let mut out = Vec::new();
        if applied > 0 {
            self.pending_acks.push_back(PendingAck {
                conn,
                id,
                through_seq: self.seq,
            });
            out.extend(self.maybe_emit_persist_ops());
            if !blame.is_empty() {
                out.push(Effect::RecordBlame { events: blame });
            }
            // Deliberately NO broadcast here. The order is apply → persist →
            // ack → broadcast: peers must never see an op that a crash could
            // still erase from the log. Broadcasts are released alongside the
            // acks in `on_ops_persisted`.
            if self.persist_timer.is_none() {
                let (token, effect) =
                    self.schedule(TimerKind::PersistDebounce, PERSIST_DEBOUNCE_MS);
                self.persist_timer = Some(token);
                out.push(effect);
            }
        }

        if poisoned {
            out.push(Effect::Close {
                conn,
                reason: CloseReason::Protocol,
            });
        }

        let reason: Cow<'static, str> = match (applied, poisoned) {
            (0, true) => "update rejected by replica; closing".into(),
            (0, false) => "empty update batch".into(),
            (n, false) => format!("applied {n} updates").into(),
            (n, true) => format!("applied {n} updates; batch aborted by rejected op").into(),
        };
        Outcome::act(reason, out)
    }
}
