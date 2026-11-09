//! Pure ports for a caller-owned foreign peer driver; process I/O stays in tests.
use super::*;
use crate::network::{Link, Packet};
use doc_sync_core::{ChatterMessage, StoredWalRecord, SyncDocId, WalOwner, WalRecord};
use sync_protocol::framing::Reassembler;
use sync_server_core::domain::socket::WebSocketId;

/// A delivered adapter event. Frame bytes include the real framing header.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExternalEvent {
    /// Server-to-peer frame.
    Frame(Vec<u8>),
    /// Server text, including heartbeat replies.
    Text(String),
    /// Native sibling's real BroadcastChannel update.
    Chatter {
        /// Whether awareness rather than a document update.
        awareness: bool,
        /// Actual encoded bytes.
        bytes: Vec<u8>,
    },
    /// Socket runtime closed.
    Closed(u16),
}
/// Host-supplied identity reserved by the same world RNG as native clients.
#[derive(Clone, Copy, Debug)]
pub struct ExternalIdentity {
    /// Fresh Loro peer; install before importing or editing.
    pub peer: u64,
    /// Session identity for host replay correlation.
    pub session: SessionId,
}
pub(super) struct ExternalPeer {
    spec: OpenSpec,
    identity: ExternalIdentity,
    vv: Vv,
    outgoing: Vec<ExternalEvent>,
}

impl Sim {
    /// Apply an interactive host transition. The host retains its complete
    /// command transcript; `run` supplies final inspection and the quiet window.
    pub fn apply_step(&mut self, step: Step) -> Result<(), Failure> {
        self.stats.steps += 1;
        let result = self.step(step);
        if self.config.per_step {
            self.validate();
        }
        result
    }
    /// Current monotonic clock for a foreign driver's injected timers.
    pub fn now(&self) -> Millis {
        self.clock.now()
    }
    /// Reserve an external endpoint without constructing a shadow native client.
    pub fn register_external(&mut self, spec: OpenSpec) -> Result<ExternalIdentity, Failure> {
        if self.clients.contains_key(&spec.client) || self.external.contains_key(&spec.client) {
            return Err(Failure::new(
                "external_identity",
                "client name already exists",
            ));
        }
        if !self.servers.contains_key(&spec.doc) {
            return Err(Failure::new("external_identity", "unknown document"));
        }
        let identity = ExternalIdentity {
            peer: self.peer(spec.kind),
            session: SessionId(self.uuid()),
        };
        self.external.insert(
            spec.client.clone(),
            ExternalPeer {
                spec,
                identity,
                vv: Vv::new(),
                outgoing: Vec::new(),
            },
        );
        Ok(identity)
    }
    /// Connect through the existing SimServer and real room grant. This T0 port
    /// uses one direct socket and requires idle Room ingress; router and fault
    /// stories remain native. Reject busy setup before creating a socket.
    pub fn connect_external(&mut self, name: &ClientName) -> Result<(), Failure> {
        let peer = self
            .external
            .get(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        let spec = peer.spec.clone();
        let session = peer.identity.session;
        let server = self
            .servers
            .get(&spec.doc)
            .ok_or_else(|| Failure::new("external_identity", "unknown server"))?;
        if server.busy_until > self.clock.now
            || !server.inbox.is_empty()
            || server.ingress_scheduled
        {
            return Err(Failure::new(
                "external_connect_busy",
                "foreign setup requires idle Room ingress",
            ));
        }
        if self.net.links.contains_key(&(name.clone(), session, 1)) {
            return Err(Failure::new(
                "external_connect_duplicate",
                "T0 foreign identity supports one socket lifetime",
            ));
        }
        let uuid = self.uuid();
        let socket = WebSocketId::new(uuid_value::Uuid::from_u128(uuid.as_u128()));
        let server = self
            .servers
            .get_mut(&spec.doc)
            .ok_or_else(|| Failure::new("external_identity", "unknown server"))?;
        let input = Input::Connect {
            grant: server.grant("user-0".into(), spec.access, None),
            key: server.key.clone(),
            socket: uuid,
        };
        let callback = server.step(SimServer::now(self.clock.wall(0), self.clock.now), input);
        let accepted = callback.accepted && !callback.crashed;
        self.net.links.insert(
            (name.clone(), session, 1),
            Link {
                socket: Some(socket.clone()),
                open: accepted,
                doc: spec.doc,
                claims: None,
                token_valid: true,
                tails: [0, 0],
                up: Reassembler::default(),
                down: Reassembler::default(),
                up_kind: FrameKind::Unknown,
                down_kind: FrameKind::Unknown,
                frames: [Vec::new(), Vec::new()],
            },
        );
        self.callback(spec.doc, callback)?;
        if !accepted {
            self.server_input(spec.doc, Input::Runtime(ServerInput::Close(socket)))?;
            return Err(Failure::new(
                "external_connect",
                "room rejected foreign peer",
            ));
        }
        Ok(())
    }
    /// Inject a real framed peer message into the same FIFO network and server.
    pub fn external_frame(&mut self, name: &ClientName, frame: Vec<u8>) -> Result<(), Failure> {
        let peer = self
            .external
            .get(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        self.transmit(
            (name.clone(), peer.identity.session, 1),
            Direction::ToServer,
            FrameKind::Unknown,
            Packet::Binary(frame),
        );
        Ok(())
    }
    /// Inject a foreign socket's text frame (the shipping heartbeat ping).
    pub fn external_text(&mut self, name: &ClientName, text: String) -> Result<(), Failure> {
        let peer = self
            .external
            .get(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        self.transmit(
            (name.clone(), peer.identity.session, 1),
            Direction::ToServer,
            FrameKind::Ping,
            Packet::Text(text),
        );
        Ok(())
    }
    /// Forward a real external chatter message to native siblings of that profile.
    pub fn external_chatter(
        &mut self,
        name: &ClientName,
        awareness: bool,
        bytes: Vec<u8>,
    ) -> Result<(), Failure> {
        let peer = self
            .external
            .get(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        let targets = self
            .clients
            .iter()
            .filter(|(_, client)| {
                client.alive
                    && client.spec.profile == peer.spec.profile
                    && client.spec.doc == peer.spec.doc
            })
            .map(|(name, client)| (name.clone(), client.session))
            .collect::<Vec<_>>();
        for (target, session) in targets {
            let message = if awareness {
                ChatterMessage::Awareness(bytes.clone())
            } else {
                ChatterMessage::Update(bytes.clone())
            };
            self.schedule(
                self.clock.now.saturating_add(1),
                Pending::Input(target, session, SyncInput::Chatter(message)),
            );
        }
        Ok(())
    }
    /// Record actual child-reported VV growth before delivering its outgoing bytes.
    pub fn external_versions(&mut self, name: &ClientName, current: Vv) -> Result<(), Failure> {
        let peer = self
            .external
            .get_mut(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        let spans = current
            .iter()
            .filter_map(|(id, end)| {
                let start = peer.vv.get(id).copied().unwrap_or(0);
                (*id == peer.identity.peer && *end > start).then_some(IdSpan {
                    peer: *id,
                    start,
                    end: *end,
                })
            })
            .collect::<Vec<_>>();
        let doc = peer.spec.doc;
        peer.vv = current;
        if !spans.is_empty() {
            self.emit(Fact::ExternalCommit {
                client: name.clone(),
                doc,
                spans,
            });
        }
        Ok(())
    }
    /// Record actual local-update ranges from a foreign editor's commit subscription.
    /// Imported VV growth alone is never evidence of local authorship.
    pub fn external_authored(
        &mut self,
        name: &ClientName,
        current: Vv,
        spans: Vec<IdSpan>,
    ) -> Result<(), Failure> {
        if spans.iter().any(|span| {
            span.start < 0
                || span.end <= span.start
                || current.get(&span.peer).copied().unwrap_or(0) < span.end
        }) {
            return Err(Failure::new(
                "external_commit",
                "local range exceeds the observed document",
            ));
        }
        let peer = self
            .external
            .get_mut(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        let doc = peer.spec.doc;
        peer.vv = current;
        if !spans.is_empty() {
            self.emit(Fact::ExternalCommit {
                client: name.clone(),
                doc,
                spans,
            });
        }
        Ok(())
    }
    /// Drain actual delivered frames/chatter. Child execution remains caller-owned.
    pub fn external_events(&mut self, name: &ClientName) -> Vec<ExternalEvent> {
        self.external
            .get_mut(name)
            .map(|peer| std::mem::take(&mut peer.outgoing))
            .unwrap_or_default()
    }
    /// Close the foreign socket through the normal runtime/room callback path.
    pub fn close_external(&mut self, name: &ClientName) -> Result<(), Failure> {
        let peer = self
            .external
            .get(name)
            .ok_or_else(|| Failure::new("external_identity", "unknown peer"))?;
        self.break_link(&(name.clone(), peer.identity.session, 1), 1000)
    }
    /// Copy only committed, actually observed v1 rows from a stopped TS browser
    /// into its native storage adapter. Missing owner means Legacy, never a new session.
    pub fn import_legacy_rows(
        &mut self,
        profile: ProfileName,
        doc: DocIx,
        rows: Vec<WalRecord>,
    ) -> Result<(), Failure> {
        let key = SyncDocId::new(format!(
            "00000000-0000-7000-8000-{:012x}",
            u64::from(doc.0) + 1
        ))
        .map_err(|error| Failure::new("external_storage", error))?;
        let store = self
            .profiles
            .entry(profile)
            .or_insert_with(|| SimStorage::new(self.config.storage.clone()));
        for record in rows {
            let key = (key.clone(), WalOwner::Legacy, record.seq);
            if store.durable.entries.contains_key(&key) {
                return Err(Failure::new(
                    "external_storage",
                    "legacy row identity collision",
                ));
            }
            store.durable.entries.insert(
                key,
                StoredWalRecord {
                    record,
                    delivered: false,
                },
            );
        }
        Ok(())
    }
    /// Inspect actual native durable rows for a rollback adapter handoff.
    pub fn profile_image(&self, profile: &ProfileName) -> Option<&StoreImage> {
        self.profiles.get(profile).map(SimStorage::image)
    }
    pub(super) fn external_native_chatter(
        &mut self,
        source: &ClientName,
        awareness: bool,
        bytes: &[u8],
    ) {
        let Some(client) = self.clients.get(source) else {
            return;
        };
        for peer in self.external.values_mut().filter(|peer| {
            peer.spec.profile == client.spec.profile && peer.spec.doc == client.spec.doc
        }) {
            peer.outgoing.push(ExternalEvent::Chatter {
                awareness,
                bytes: bytes.to_vec(),
            });
        }
    }
    pub(super) fn external_closed(&mut self, name: &ClientName, code: u16) -> bool {
        let Some(peer) = self.external.get_mut(name) else {
            return false;
        };
        peer.outgoing.push(ExternalEvent::Closed(code));
        true
    }
    pub(super) fn external_deliver(&mut self, name: &ClientName, packet: Packet) -> bool {
        let Some(peer) = self.external.get_mut(name) else {
            return false;
        };
        peer.outgoing.push(match packet {
            Packet::Binary(bytes) => ExternalEvent::Frame(bytes),
            Packet::Text(text) => ExternalEvent::Text(text),
        });
        true
    }
}

#[cfg(test)]
mod test;
