use super::*;
use crate::{
    clock::delay,
    network::{Delivery, Link, Transit},
};
use bebop::Record;
use doc_sync_core::{
    AttrValue, ChatterMessage, StorageOp, SyncEvent, TelemetryKind, TokenEvent, WriteAccess,
};
use loro::ToJson;
use sync_protocol::framing::Reassembler;

impl Sim {
    pub(super) fn outputs(
        &mut self,
        name: &ClientName,
        session: SessionId,
        out: SyncOutput,
    ) -> Result<(), Failure> {
        for effect in out.io {
            match effect {
                IoEffect::Storage { id, op } => {
                    let Some(client) = self.clients.get(name) else {
                        continue;
                    };
                    let profile = client.spec.profile.clone();
                    let wall_offset = client.skew;
                    if let StorageOp::WalAppend { owner, record, .. } = &op {
                        self.emit(Fact::WalAppendIssued {
                            client: name.clone(),
                            profile: profile.clone(),
                            session: *owner,
                            seq: record.seq,
                            spans: spans(&record.bytes).unwrap_or_default(),
                            foreign: record.foreign,
                        });
                    }
                    let now = self.clock.now;
                    if let Some(store) = self.profiles.get_mut(&profile) {
                        if !store
                            .leases
                            .contains(&(crate::storage::document(&op).clone(), session))
                        {
                            return Err(Failure::new(
                                "storage_lease",
                                "storage effect preceded its session lease grant",
                            ));
                        }
                        let (token, at) = store.issue(
                            PendingWrite {
                                client: name.clone(),
                                session,
                                id,
                                op,
                            },
                            now,
                            &mut self.rng,
                        );
                        self.schedule(at, Pending::Storage(profile, token, wall_offset));
                    }
                }
                IoEffect::FetchToken { attempt, .. } => {
                    let Some(client) = self.clients.get_mut(name) else {
                        continue;
                    };
                    let failed = self.net.offline.contains(name) || client.token_failures > 0;
                    client.token_failures = client.token_failures.saturating_sub(1);
                    let access = client.spec.access;
                    let token = format!("sim-token-{}-{attempt}", session.0);
                    let event = if failed {
                        TokenEvent::Failed { attempt }
                    } else {
                        self.tokens.insert(
                            token.clone(),
                            crate::model::TokenGrant::issue(client, self.clock.wall(0)),
                        );
                        TokenEvent::Fetched {
                            attempt,
                            token: doc_sync_core::SyncToken::new(token),
                            access: match access {
                                Access::Edit => WriteAccess::Full,
                                Access::CommentOnly => WriteAccess::CommentMarks,
                                Access::Read => WriteAccess::None,
                            },
                        }
                    };
                    let at = self
                        .clock
                        .now
                        .saturating_add(self.rng.random_range(20..=200));
                    self.schedule(
                        at,
                        Pending::Input(name.clone(), session, SyncInput::Token(event)),
                    );
                }
                IoEffect::SocketConnect { conn, token, .. } => {
                    let Some(client) = self.clients.get_mut(name) else {
                        continue;
                    };
                    let claims = self.tokens.get(token.expose_secret()).cloned();
                    let valid = claims.as_ref().is_some_and(|claims| {
                        claims.doc == client.doc_id && claims.issued_by == session
                    });
                    let key = (name.clone(), session, conn.0);
                    self.net.links.insert(
                        key,
                        Link {
                            socket: None,
                            open: false,
                            doc: client.spec.doc,
                            claims,
                            token_valid: valid,
                            tails: [0, 0],
                            up: Reassembler::default(),
                            down: Reassembler::default(),
                            up_kind: FrameKind::Unknown,
                            down_kind: FrameKind::Unknown,
                            frames: [Vec::new(), Vec::new()],
                        },
                    );
                    let at = self
                        .clock
                        .now
                        .saturating_add(delay(self.net.profile.connect_latency, &mut self.rng));
                    self.schedule(at, Pending::Connect(name.clone(), session, conn.0));
                }
                IoEffect::SocketSend { conn, frame } => {
                    if self.clients.get(name).is_some_and(|client| client.routed) {
                        self.router_send(name, frame)?;
                        continue;
                    }
                    let key = (name.clone(), session, conn.0);
                    let (kind, message) = if let Some(link) = self.net.links.get_mut(&key) {
                        let message = link
                            .up
                            .push(&frame)
                            .map_err(|e| Failure::new("outbound_framing", e))?;
                        if let Some(bytes) = &message {
                            link.up_kind = crate::network::kind(bytes, Direction::ToServer);
                        }
                        (link.up_kind, message)
                    } else {
                        continue;
                    };
                    if let Some(message) = message {
                        self.observe_push(name, session, &message)?;
                    }
                    self.transmit(key, Direction::ToServer, kind, Packet::Binary(frame));
                }
                IoEffect::SocketPing { conn } => self.transmit(
                    (name.clone(), session, conn.0),
                    Direction::ToServer,
                    FrameKind::Ping,
                    Packet::Text("ping".into()),
                ),
                IoEffect::SocketClose { conn, code, reason } => {
                    self.emit(Fact::SocketClose {
                        client: name.clone(),
                        connection: conn.0,
                        code,
                        reason: format!("{reason:?}"),
                    });
                    let key = (name.clone(), session, conn.0);
                    if let Some(link) = self.net.links.get(&key) {
                        let at = link.tails[0].max(self.clock.now).saturating_add(1);
                        self.schedule(at, Pending::Close(name.clone(), session, conn.0, code));
                    }
                }
                IoEffect::ChatterPost(message) => {
                    let Some(client) = self.clients.get(name) else {
                        continue;
                    };
                    let targets = self
                        .clients
                        .iter()
                        .filter(|(other, peer)| {
                            *other != name
                                && peer.alive
                                && peer.spec.profile == client.spec.profile
                                && peer.spec.doc == client.spec.doc
                                && peer.user == client.user
                        })
                        .map(|(other, peer)| (other.clone(), peer.session))
                        .collect::<Vec<_>>();
                    for (other, owner) in targets {
                        let copied = match &message {
                            ChatterMessage::Update(bytes) => ChatterMessage::Update(bytes.clone()),
                            ChatterMessage::Awareness(bytes) => {
                                ChatterMessage::Awareness(bytes.clone())
                            }
                            ChatterMessage::Closing(id) => ChatterMessage::Closing(*id),
                        };
                        let tail = self.chatter_tails.entry((session, owner)).or_default();
                        let at = self
                            .clock
                            .now
                            .saturating_add(self.rng.random_range(0..=2))
                            .max(tail.saturating_add(1));
                        *tail = at;
                        self.schedule(at, Pending::Input(other, owner, SyncInput::Chatter(copied)));
                    }
                }
                IoEffect::Telemetry(record) => {
                    let event_name = match record.kind {
                        TelemetryKind::Start { name } | TelemetryKind::Event { name } => {
                            name.to_string()
                        }
                        TelemetryKind::End { outcome, .. } => format!("span.end:{outcome}"),
                    };
                    let attributes: BTreeMap<String, serde_json::Value> = record
                        .attrs
                        .into_iter()
                        .map(|(key, value)| {
                            (
                                key.into(),
                                match value {
                                    AttrValue::String(value) => value.into(),
                                    AttrValue::U64(value) => value.into(),
                                    AttrValue::I64(value) => value.into(),
                                    AttrValue::Bool(value) => value.into(),
                                },
                            )
                        })
                        .collect();
                    if event_name == "peer.assigned"
                        && let Some(peer) =
                            attributes.get("peer").and_then(serde_json::Value::as_u64)
                    {
                        self.emit(Fact::PeerAssigned {
                            client: name.clone(),
                            peer,
                            purpose: attributes
                                .get("purpose")
                                .and_then(serde_json::Value::as_str)
                                .unwrap_or("")
                                .into(),
                        });
                    }
                    if event_name == "doc.sync.rebase" {
                        self.stats.rebases = self.stats.rebases.saturating_add(1);
                    }
                    self.emit(Fact::Telemetry {
                        client: name.clone(),
                        name: event_name,
                        attributes,
                    });
                }
                IoEffect::RouteDetach { .. } => self.router_detach(name)?,
                IoEffect::RouteReconnect { doc } => {
                    let profile = self
                        .clients
                        .get(name)
                        .map(|client| client.spec.profile.clone())
                        .ok_or_else(|| {
                            Failure::new("router_owner", "route reconnect without a client")
                        })?;
                    if let Some(host) = self.routers.get_mut(&profile) {
                        host.authority.insert(doc.to_string(), name.clone());
                    }
                    self.router_input(&profile, doc_sync_core::RouterInput::Reconnect(doc))?;
                }
                IoEffect::RouterConnect { .. } => {
                    return Err(Failure::new(
                        "executor_contract",
                        "routed effect in a direct GenericSurface session",
                    ));
                }
            }
        }
        let mut ready = false;
        for event in out.events {
            match event {
                SyncEvent::Seeded { kind, replayed_wal } => {
                    ready = true;
                    self.emit(Fact::Seeded {
                        client: name.clone(),
                        session,
                        kind: format!("{kind:?}"),
                        replayed_wal,
                    });
                }
                SyncEvent::Replaced => ready = true,
                SyncEvent::Status(status) => self.emit(Fact::Status {
                    client: name.clone(),
                    status,
                }),
                SyncEvent::Presence(peers) => {
                    let remote = peers
                        .into_iter()
                        .map(|peer| {
                            serde_json::from_str(&peer.value.to_json())
                                .map(|value| (peer.key, value))
                        })
                        .collect::<Result<BTreeMap<_, _>, _>>()
                        .map_err(|e| Failure::new("presence_value", e))?;
                    if let Some(client) = self.clients.get_mut(name) {
                        client.remote = remote.clone();
                    }
                    self.emit(Fact::PresenceChanged {
                        client: name.clone(),
                        remote,
                    });
                }
                SyncEvent::AccessChanged(access) => {
                    let access = match access {
                        doc_sync_core::Access::Edit => Access::Edit,
                        doc_sync_core::Access::CommentOnly => Access::CommentOnly,
                        doc_sync_core::Access::Read => Access::Read,
                    };
                    if let Some(client) = self.clients.get_mut(name) {
                        client.spec.access = access;
                    }
                    self.emit(Fact::AccessChanged {
                        client: name.clone(),
                        access,
                    });
                }
                SyncEvent::Reply { request, reply } => {
                    let text = match reply {
                        doc_sync_core::Reply::Stopped => {
                            if let Some(client) = self.clients.get_mut(name) {
                                client.stopped = true;
                            }
                            "Stopped".into()
                        }
                        doc_sync_core::Reply::Flush(result) => format!("Flush({result:?})"),
                        doc_sync_core::Reply::Comment(result) => format!("Comment({result:?})"),
                        doc_sync_core::Reply::Snapshot(result) => match result {
                            Ok(bytes) => format!("Snapshot({} bytes)", bytes.len()),
                            Err(error) => format!("Snapshot({error:?})"),
                        },
                    };
                    self.emit(Fact::Reply {
                        client: name.clone(),
                        request: request.0,
                        reply: text,
                    });
                }
            }
        }
        if ready {
            self.input(name, session, SyncInput::Ready)?;
        }
        self.finish_close(name)?;
        Ok(())
    }
    pub(super) fn observe_push(
        &mut self,
        name: &ClientName,
        session: SessionId,
        message: &[u8],
    ) -> Result<(), Failure> {
        if let Ok(sync_protocol::FromPeer::PeerUpdate { id, updates }) =
            sync_protocol::FromPeer::deserialize(message)
        {
            let ranges = updates
                .iter()
                .map(|update| spans(update.as_ref()))
                .collect::<Result<Vec<_>, _>>()?
                .into_iter()
                .flatten()
                .collect::<Vec<_>>();
            let Some(client) = self.clients.get(name) else {
                return Ok(());
            };
            let mut rows = Vec::new();
            let mut own_bytes = 0;
            let mut foreign_bytes = 0;
            for row in &client.core.wal().entries {
                if client
                    .core
                    .wal()
                    .delivered_through
                    .is_some_and(|through| row.seq <= through)
                    || row.superseded
                {
                    continue;
                }
                if spans(&row.bytes).is_ok_and(|row_ranges| {
                    row_ranges.iter().all(|row_range| {
                        ranges.iter().any(|range| {
                            range.peer == row_range.peer
                                && range.start <= row_range.start
                                && range.end >= row_range.end
                        })
                    })
                }) {
                    rows.push((doc_sync_core::WalOwner::Session(session), row.seq));
                    if row.foreign {
                        foreign_bytes += u64::try_from(row.bytes.len()).unwrap_or(0);
                    } else {
                        own_bytes += u64::try_from(row.bytes.len()).unwrap_or(0);
                    }
                }
            }
            // Assist sends retain the durable foreign owner; never attribute them
            // to the sending session merely because its socket carried them.
            if rows.is_empty()
                && let Some(store) = self.profiles.get(&client.spec.profile)
            {
                for ((doc, owner, seq), row) in &store.durable.entries {
                    if doc != &client.core_doc_id() || row.delivered {
                        continue;
                    }
                    if spans(&row.record.bytes).is_ok_and(|row_ranges| {
                        row_ranges.iter().all(|row_range| {
                            ranges.iter().any(|range| {
                                range.peer == row_range.peer
                                    && range.start <= row_range.start
                                    && range.end >= row_range.end
                            })
                        })
                    }) {
                        rows.push((*owner, *seq));
                        foreign_bytes += u64::try_from(row.record.bytes.len()).unwrap_or(0);
                    }
                }
            }
            self.emit(Fact::PushSent {
                client: name.clone(),
                update: id.into(),
                rows,
                spans: ranges,
                foreign_bytes,
                own_bytes,
            });
        }
        Ok(())
    }
    pub(super) fn transmit(
        &mut self,
        key: LinkKey,
        direction: Direction,
        kind: FrameKind,
        packet: Packet,
    ) {
        if self.router_profile(&key).is_some() {
            self.transmit_router_frame(key, direction, kind, packet);
            return;
        }
        let Packet::Binary(frame) = packet else {
            self.transmit_frame(key, direction, kind, packet, false);
            return;
        };
        let index = usize::from(direction == Direction::ToClient);
        let Some(link) = self.net.links.get_mut(&key) else {
            return;
        };
        let final_chunk = frame.first() == Some(&1);
        link.frames[index].push(frame);
        if !final_chunk {
            return;
        }
        let frames = std::mem::take(&mut link.frames[index]);
        self.transmit_message(key, direction, frames, None);
    }
    fn transmit_router_frame(
        &mut self,
        key: LinkKey,
        direction: Direction,
        kind: FrameKind,
        packet: Packet,
    ) {
        let Packet::Binary(bytes) = &packet else {
            self.transmit_frame(key, direction, kind, packet, false);
            return;
        };
        let inner = match direction {
            Direction::ToServer => match sync_protocol::ToRouter::deserialize(bytes) {
                Ok(sync_protocol::ToRouter::RouterFrame { doc_id, payload }) => {
                    Some((doc_id.to_owned(), payload.iter().collect::<Vec<_>>()))
                }
                _ => None,
            },
            Direction::ToClient => match sync_protocol::FromRouter::deserialize(bytes) {
                Ok(sync_protocol::FromRouter::RouterDocFrame { doc_id, payload }) => {
                    Some((doc_id.to_owned(), payload.iter().collect::<Vec<_>>()))
                }
                _ => None,
            },
        };
        let Some((doc, frame)) = inner else {
            self.transmit_frame(key, direction, kind, packet, false);
            return;
        };
        let final_chunk = frame.first() == Some(&1);
        let identity = (key.clone(), direction, doc.clone());
        self.net
            .router_frames
            .entry(identity.clone())
            .or_default()
            .push(frame);
        if final_chunk {
            let frames = self.net.router_frames.remove(&identity).unwrap_or_default();
            self.transmit_message(key, direction, frames, Some(doc));
        }
    }
    fn transmit_message(
        &mut self,
        key: LinkKey,
        direction: Direction,
        mut frames: Vec<Vec<u8>>,
        route: Option<String>,
    ) {
        let index = usize::from(direction == Direction::ToClient);
        let message = frames
            .iter()
            .flat_map(|frame| frame.iter().skip(1).copied())
            .collect::<Vec<_>>();
        let kind = crate::network::kind(&message, direction);
        let hostile = self.net.profile.hostile.clone().unwrap_or_default();
        let duplicate = matches!(
            kind,
            FrameKind::Update | FrameKind::RemoteUpdate | FrameKind::Ack | FrameKind::Awareness
        ) && hostile.duplicate > 0.0
            && self.rng.random_bool(hostile.duplicate.clamp(0.0, 1.0));
        if hostile.reorder > 0.0 && self.rng.random_bool(hostile.reorder.clamp(0.0, 1.0)) {
            let extra = self.rng.random_range(
                1..=self
                    .net
                    .profile
                    .latency
                    .0
                    .0
                    .max(self.net.profile.latency.1.0)
                    .max(1)
                    .saturating_mul(4),
            );
            if let Some(link) = self.net.links.get_mut(&key) {
                link.tails[index] = link.tails[index].max(self.clock.now).saturating_add(extra);
            }
        }
        let corrupted = self.net.corrupt_message(&key, direction, &mut frames);
        let copies = if duplicate { 2 } else { 1 };
        for _ in 0..copies {
            let drop = (frames.len() > 1
                && hostile.drop_frame > 0.0
                && self.rng.random_bool(hostile.drop_frame.clamp(0.0, 1.0)))
            .then(|| self.rng.random_range(0..frames.len()));
            for (index, frame) in frames.iter().enumerate() {
                let bytes = if let Some(doc) = &route {
                    let mut bytes = Vec::new();
                    let result = match direction {
                        Direction::ToServer => sync_protocol::ToRouter::RouterFrame {
                            doc_id: doc,
                            payload: bebop::SliceWrapper::Raw(frame),
                        }
                        .serialize(&mut bytes),
                        Direction::ToClient => sync_protocol::FromRouter::RouterDocFrame {
                            doc_id: doc,
                            payload: bebop::SliceWrapper::Raw(frame),
                        }
                        .serialize(&mut bytes),
                    };
                    if let Err(error) = result {
                        self.fail(Failure::new("router_encode", error));
                        return;
                    }
                    bytes
                } else {
                    frame.clone()
                };
                let packet = Packet::Binary(bytes);
                if drop == Some(index) {
                    self.frame_fact(&key, direction, kind, &packet, "Dropped");
                } else {
                    self.transmit_frame(key.clone(), direction, kind, packet, corrupted);
                }
            }
        }
    }
    fn transmit_frame(
        &mut self,
        key: LinkKey,
        direction: Direction,
        kind: FrameKind,
        packet: Packet,
        corrupted: bool,
    ) {
        let transit = self
            .net
            .transit(&key, direction, kind, self.clock.now, &mut self.rng);
        match transit {
            Transit::Dropped => self.frame_fact(&key, direction, kind, &packet, "Dropped"),
            Transit::Broken => {
                self.frame_fact(&key, direction, kind, &packet, "Lost");
                if let Err(error) = self.break_link(&key, 1006) {
                    self.fail(error);
                }
            }
            Transit::Deliver { at } => {
                let delivery = Delivery {
                    packet,
                    kind,
                    corrupted,
                };
                let event = if direction == Direction::ToServer {
                    Pending::Up(key.0.clone(), key.1, key.2, delivery.clone())
                } else {
                    Pending::Down(key.0.clone(), key.1, key.2, delivery.clone())
                };
                self.schedule(at, event);
            }
        }
    }
    pub(super) fn frame_fact(
        &mut self,
        key: &LinkKey,
        direction: Direction,
        kind: FrameKind,
        packet: &Packet,
        fate: &str,
    ) {
        let bytes = match packet {
            Packet::Binary(bytes) => bytes.len(),
            Packet::Text(text) => text.len(),
        };
        self.stats.frames = self.stats.frames.saturating_add(1);
        self.emit(Fact::Frame {
            client: key.0.clone(),
            connection: key.2,
            direction,
            kind,
            bytes: u32::try_from(bytes).unwrap_or(u32::MAX),
            frames: 1,
            fate: fate.into(),
        });
    }
}
