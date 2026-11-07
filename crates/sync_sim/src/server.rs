//! Real native room driver, held output gate and cold durable-state inspection.
use crate::{
    document::{SimDoc, spans, vv},
    *,
};
use bebop::{Record, SliceWrapper};
use futures::FutureExt;
use std::{
    collections::{BTreeMap, VecDeque},
    time::Duration,
};
use sync_server_core::domain::socket::WebSocketId;
use sync_server_core::domain::{
    permissions::{AccessLevel, AuthToken},
    types::SessionKey,
};
use sync_server_sim::{
    ports::{Effect, GateMode, SimNow, SimPorts},
    replay::{SimRoom, StepResult},
    transcript::ServerInput,
};

pub(crate) enum Input {
    Runtime(ServerInput),
    Exists,
}
pub(crate) struct Callback {
    pub index: u64,
    pub effects: Vec<Effect>,
    pub generation: u64,
    pub blocking: bool,
    pub updates: Vec<String>,
    pub facts: Vec<Fact>,
    pub error: Option<Failure>,
    pub crashed: bool,
}
/// One real Room and its existing synchronous simulation ports per document.
pub struct SimServer {
    doc: DocIx,
    pub(crate) local_seed: Option<Vec<u8>>,
    pub(crate) s3_seed: Option<(Vec<u8>, Millis)>,
    pub(crate) optimistic_seed: bool,
    pub(crate) room: SimRoom,
    pub(crate) ports: SimPorts,
    pub(crate) key: SessionKey,
    pub(crate) busy_until: u64,
    pub(crate) inbox: VecDeque<Input>,
    pub(crate) ingress_generation: u64,
    pub(crate) ingress_scheduled: bool,
    pub(crate) storage_latency: Millis,
    pub(crate) callback: u64,
    pub(crate) epoch: u64,
    pub(crate) pending_durable: usize,
    pub(crate) completions: BTreeMap<u64, (u64, bool, Vec<String>)>,
    pub(crate) alarm_generation: u64,
    sniffers: BTreeMap<WebSocketId, sync_protocol::framing::Reassembler>,
}
impl SimServer {
    pub(crate) fn new(
        doc: DocIx,
        fields: u16,
        seed_spec: &SeedDocument,
        storage_latency: Millis,
        now: SimNow,
    ) -> Result<(Self, Vec<Effect>, Vv), Failure> {
        let key = SessionKey::new(format!(
            "00000000-0000-7000-8000-{:012x}",
            u64::from(doc.0) + 1
        ));
        let ports = SimPorts::new();
        ports.set_now(now);
        let mut room = SimRoom::new(ports.clone());
        let seed =
            crate::document::seed_snapshots(1 + u64::from(doc.0), fields, now.unix_ms, seed_spec)?;
        let snapshot = &seed.server;
        let request = sync_protocol::InitializeFromSnapshotRequest {
            snapshot: SliceWrapper::from_cooked(snapshot),
        };
        let mut body = Vec::new();
        request
            .serialize(&mut body)
            .map_err(|e| Failure::new("seed_document", e))?;
        room.room_mut()
            .initialize(key.clone(), &body)
            .now_or_never()
            .ok_or_else(|| Failure::new("server_stalled", "initialization stalled"))?
            .map_err(|e| Failure::new("server_initialize", e))?;
        let effects = ports.take_effects();
        ports.set_gate(GateMode::Held);
        Ok((
            Self {
                doc,
                local_seed: seed.local,
                s3_seed: seed.s3,
                optimistic_seed: !matches!(seed_spec, SeedDocument::Cached { .. }),
                room,
                ports,
                key,
                busy_until: 0,
                inbox: VecDeque::new(),
                ingress_generation: 0,
                ingress_scheduled: false,
                storage_latency,
                callback: 1,
                epoch: 0,
                pending_durable: 0,
                completions: BTreeMap::new(),
                alarm_generation: 0,
                sniffers: BTreeMap::new(),
            },
            effects,
            seed.vv,
        ))
    }
    pub(crate) fn now(wall: i64, mono: u64) -> SimNow {
        SimNow {
            unix_ms: wall,
            monotonic: Duration::from_millis(mono),
        }
    }
    pub(crate) fn grant(&self, user: String, access: Access) -> AuthToken {
        AuthToken::new(
            self.key.as_str().into(),
            match access {
                Access::Edit => AccessLevel::Edit,
                Access::CommentOnly => AccessLevel::Comment,
                Access::Read => AccessLevel::View,
            },
            macro_sync_service_jwt::session::SessionKind::Document,
            Some(user),
            None,
            None,
            None,
        )
    }
    pub(crate) fn step(&mut self, now: SimNow, input: Input) -> Callback {
        let index = self.callback;
        self.callback = self.callback.saturating_add(1);
        let mut received = None;
        if let Input::Runtime(ServerInput::Binary { socket, bytes }) = &input {
            let sniffer = self.sniffers.entry(socket.clone()).or_default();
            if let Ok(Some(message)) = sniffer.push(bytes)
                && let Ok(sync_protocol::FromPeer::PeerUpdate { id, updates }) =
                    sync_protocol::FromPeer::deserialize(&message)
            {
                let ranges = updates
                    .iter()
                    .map(|update| spans(update.as_ref()))
                    .collect::<Result<Vec<_>, _>>();
                if let Ok(ranges) = ranges {
                    received = Some((
                        id.to_string(),
                        ranges.into_iter().flatten().collect::<Vec<_>>(),
                    ));
                }
            }
        }
        self.ports.take_completed_puts();
        let before_generation = self.ports.write_generation();
        let result = match input {
            Input::Runtime(input) => self.room.step(now, input),
            Input::Exists => {
                self.ports.set_now(now);
                match self.room.room_mut().exists(&self.key).now_or_never() {
                    Some(Ok(_)) => Ok(StepResult::Done(self.ports.take_effects())),
                    Some(Err(e)) => Err(sync_server_sim::replay::ReplayError::Callback(
                        e.to_string(),
                    )),
                    None if self.ports.crashed() => {
                        Ok(StepResult::Crashed(self.ports.take_effects()))
                    }
                    None => Err(sync_server_sim::replay::ReplayError::Mismatch(
                        "server callback stalled".into(),
                    )),
                }
            }
        };
        let (effects, mut error, crashed) = match result {
            Ok(StepResult::Done(effects)) => (effects, None, false),
            Ok(StepResult::Crashed(effects)) => (effects, None, true),
            Err(error) => (
                self.ports.take_effects(),
                Some(Failure::new("server_callback", error)),
                self.ports.crashed(),
            ),
        };
        self.busy_until = now.monotonic.as_millis().try_into().unwrap_or(u64::MAX);
        self.busy_until = self
            .busy_until
            .saturating_add(u64::try_from(self.ports.busy_for().as_millis()).unwrap_or(u64::MAX));
        let mut facts = Vec::new();
        let mut updates = Vec::new();
        let mut written = Vec::new();
        for (key, value, generation) in self.ports.take_completed_puts() {
            if !key.starts_with("o/") {
                continue;
            }
            let parsed = serde_json::from_value::<Vec<u8>>(value)
                .map_err(|failure| Failure::new("stored_operation", failure))
                .and_then(|bytes| spans(&bytes));
            match parsed {
                Ok(spans) => {
                    written.extend(spans.clone());
                    facts.push(Fact::PendingStored {
                        doc: self.doc,
                        callback: index,
                        key,
                        spans,
                        generation,
                    });
                }
                Err(failure) => error = Some(failure),
            }
        }
        if let Some((update, ranges)) = received {
            let stored = ranges
                .iter()
                .all(|range| crate::invariants::ranges_cover(&written, range));
            if stored {
                let live = match self.live_state() {
                    Ok((vv, _)) => vv,
                    Err(failure) => {
                        error = Some(failure);
                        Vv::new()
                    }
                };
                let pending = ranges
                    .iter()
                    .any(|range| live.get(&range.peer).copied().unwrap_or(0) < range.end);
                facts.push(Fact::ServerApplied {
                    update: update.clone(),
                    spans: ranges,
                    pending,
                });
                updates.push(update);
            } else if error.is_none() && !crashed {
                facts.push(Fact::UpdateRefused {
                    update,
                    spans: ranges,
                });
            }
        }
        let generation = self.ports.write_generation();
        // Alarm metadata and presence refreshes are periodic work. Counting those
        // as new convergence work would restart the heartbeat hold every five seconds.
        let blocking = effects.iter().any(|effect| {
            matches!(
                effect.operation.as_str(),
                "storage.put"
                    | "storage.delete"
                    | "storage.delete_multiple"
                    | "storage.delete_all"
                    | "snapshot.put"
                    | "snapshot.delete"
            )
        });
        if generation > before_generation && blocking {
            self.pending_durable += 1;
        }
        Callback {
            index,
            effects,
            generation,
            blocking,
            updates,
            facts,
            error,
            crashed,
        }
    }
    pub(crate) fn evict(&mut self) {
        self.room = SimRoom::new(self.ports.clone());
        self.sniffers.clear();
    }
    pub(crate) fn live_state(&self) -> Result<(Vv, serde_json::Value), Failure> {
        let snapshot = self
            .room
            .room()
            .memory_view()
            .document
            .ok_or_else(|| Failure::new("server_state", "document not loaded"))?
            .export_snapshot(None)
            .map_err(|e| Failure::new("server_state", e))?;
        let doc = SimDoc::new(u64::MAX - 1)?;
        doc.loro
            .import(&snapshot)
            .map_err(|e| Failure::new("server_state", e))?;
        Ok((vv(&doc.loro.oplog_vv()), doc.value()?))
    }
    pub(crate) fn final_state(&mut self) -> Result<ServerFinal, Failure> {
        self.room
            .room_mut()
            .load_document()
            .now_or_never()
            .ok_or_else(|| Failure::new("server_stalled", "final load stalled"))?
            .map_err(|e| Failure::new("server_state", e))?;
        let (oplog_vv, deep_value) = self.live_state()?;
        let cold_ports = self.ports.fork_durable();
        let mut cold = SimRoom::new(cold_ports);
        cold.room_mut()
            .load_document()
            .now_or_never()
            .ok_or_else(|| Failure::new("server_stalled", "cold load stalled"))?
            .map_err(|e| Failure::new("server_persisted", e))?;
        let snapshot = cold
            .room()
            .memory_view()
            .document
            .ok_or_else(|| Failure::new("server_persisted", "no cold document"))?
            .export_snapshot(None)
            .map_err(|e| Failure::new("server_persisted", e))?;
        let restored = SimDoc::new(u64::MAX - 2)?;
        restored
            .loro
            .import(&snapshot)
            .map_err(|e| Failure::new("server_persisted", e))?;
        let pending_import = self
            .ports
            .storage_dump()
            .iter()
            .filter(|(key, _)| key.starts_with("o/"))
            .filter_map(|(_, value)| serde_json::from_value::<Vec<u8>>(value.clone()).ok())
            .any(|bytes| {
                spans(&bytes).is_ok_and(|ranges| {
                    ranges
                        .iter()
                        .any(|span| oplog_vv.get(&span.peer).copied().unwrap_or(0) < span.end)
                })
            });
        let active_peers_without_ai = self
            .room
            .room_mut()
            .active_peers(false)
            .now_or_never()
            .ok_or_else(|| Failure::new("server_stalled", "peer inspection stalled"))?
            .map_err(|e| Failure::new("server_peers", e))?
            .into_iter()
            .map(|peer| peer.0)
            .collect();
        // Final inspection is tagged separately by the world, not silently used as
        // another live input. Cold inspection only touches the forked durable ports.
        Ok(ServerFinal {
            oplog_vv,
            deep_value,
            persisted_vv: vv(&restored.loro.oplog_vv()),
            pending_import,
            active_peers_without_ai,
        })
    }
}
