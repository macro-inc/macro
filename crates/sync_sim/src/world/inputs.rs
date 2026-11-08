use super::*;
use crate::network::{Delivery, kind};
use bebop::Record;
use sync_server_core::domain::socket::WebSocketId;
use sync_server_sim::ports::Effect;

impl Sim {
    pub(super) fn pending(&mut self, event: Pending) -> Result<(), Failure> {
        match event {
            Pending::RouterWake(profile, generation) => {
                if self
                    .routers
                    .get(&profile)
                    .is_some_and(|host| host.generation == generation)
                {
                    self.router_input(&profile, doc_sync_core::RouterInput::Tick)?;
                }
            }
            Pending::RouterConnect(profile, conn) => self.router_connect(&profile, conn)?,
            Pending::RouterClose(profile, conn, code) => {
                self.router_close(&profile, ConnId(conn), code)?
            }
            Pending::RouterToken(profile, doc, event) => {
                self.router_input(&profile, doc_sync_core::RouterInput::Token { doc, event })?;
            }
            Pending::RouteConnect(profile, doc, epoch, token) => {
                self.route_connect(&profile, doc, epoch, token)?
            }
            Pending::Wake(name, session, generation) => {
                if self.clients.get(&name).is_some_and(|client| {
                    client.session == session && client.generation == generation
                }) {
                    self.input(&name, session, SyncInput::Tick)?;
                }
            }
            Pending::Input(name, session, input) => self.input(&name, session, input)?,
            Pending::Storage(profile, token, issued_offset) => {
                // Match the requesting core's current clock. Retain its issued offset
                // when a tab died/reopened before the old transaction completed.
                let offset = self
                    .profiles
                    .get(&profile)
                    .and_then(|store| store.pending.get(&token))
                    .and_then(|write| {
                        self.clients
                            .get(&write.client)
                            .filter(|client| client.session == write.session)
                    })
                    .map(|client| client.skew)
                    .unwrap_or(issued_offset);
                let wall = doc_sync_core::UnixMillis(self.clock.wall(offset));
                let completed = self
                    .profiles
                    .get_mut(&profile)
                    .and_then(|store| store.complete(token, &profile, self.clock.now, wall));
                if let Some(completion) = completed {
                    for fact in completion.facts {
                        if let Fact::WalAdopted { map, .. } = &fact {
                            self.stats.adopted_rows += u64::try_from(map.len()).unwrap_or(0);
                        }
                        self.emit(fact);
                    }
                    self.input(
                        &completion.client,
                        completion.session,
                        SyncInput::Storage(completion.event),
                    )?;
                    let names = self
                        .clients
                        .iter()
                        .filter(|(_, client)| client.spec.profile == profile)
                        .map(|(name, _)| name.clone())
                        .collect::<Vec<_>>();
                    for name in names {
                        self.finish_close(&name)?;
                    }
                }
            }
            Pending::Connect(name, session, conn) => self.connect((name, session, conn))?,
            Pending::Close(name, session, conn, code) => {
                self.break_link(&(name, session, conn), code)?
            }
            Pending::Up(name, session, conn, delivery) => {
                self.deliver((name, session, conn), Direction::ToServer, delivery)?
            }
            Pending::Down(name, session, conn, delivery) => {
                self.deliver((name, session, conn), Direction::ToClient, delivery)?
            }
            Pending::ServerReady(doc, generation) => {
                let input = self.servers.get_mut(&doc).and_then(|server| {
                    if server.ingress_generation != generation {
                        return None;
                    }
                    server.ingress_scheduled = false;
                    server.inbox.pop_front()
                });
                if let Some(input) = input {
                    self.run_server_input(doc, input)?;
                }
            }
            Pending::ServerDurable(doc, epoch, generation, callback) => {
                let (effects, completed) = if let Some(server) = self.servers.get_mut(&doc) {
                    if server.epoch != epoch {
                        return Ok(());
                    }
                    // Confirmation of a generation includes all preceding writes, even
                    // when perturbed equal-time completion events arrive out of order.
                    let keys = server
                        .completions
                        .range(..=generation)
                        .map(|(generation, _)| *generation)
                        .collect::<Vec<_>>();
                    let completed = keys
                        .into_iter()
                        .filter_map(|generation| server.completions.remove(&generation))
                        .collect::<Vec<_>>();
                    for (_, blocking, _) in &completed {
                        if *blocking {
                            server.pending_durable = server.pending_durable.saturating_sub(1);
                        }
                    }
                    server.ports.confirm_through(generation);
                    (server.ports.take_effects(), completed)
                } else {
                    return Ok(());
                };
                for (callback, _, updates) in completed {
                    for update in updates {
                        self.emit(Fact::ServerDurable { update, callback });
                    }
                }
                self.server_effects(doc, callback, effects)?;
            }
            Pending::Alarm(doc, generation) => {
                if self
                    .servers
                    .get(&doc)
                    .is_some_and(|server| server.alarm_generation == generation)
                {
                    self.server_input(doc, Input::Runtime(ServerInput::AlarmFired))?;
                }
            }
            Pending::HealDirectory(doc) => {
                if let Some(server) = self.servers.get(&doc) {
                    server.ports.set_operation_error("peers.map_unowned", None);
                    server.ports.set_operation_error("peers.claim", None);
                }
            }
        }
        Ok(())
    }
    fn connect(&mut self, key: LinkKey) -> Result<(), Failure> {
        if self.net.partitions.contains(&key.0) {
            return Ok(());
        }
        let Some(link) = self.net.links.get(&key) else {
            return Ok(());
        };
        let Some(client) = self.clients.get_mut(&key.0) else {
            return Ok(());
        };
        if !client.alive || client.session != key.1 || client.connection_id() != Some(ConnId(key.2))
        {
            return Ok(());
        }
        let expired = std::mem::take(&mut client.expire_token)
            || link
                .claims
                .as_ref()
                .is_none_or(|claims| claims.expired(self.clock.wall(0)));
        if self.net.offline.contains(&key.0) || !link.token_valid || expired {
            let at = self
                .clock
                .now
                .saturating_add(if self.net.offline.contains(&key.0) {
                    self.net.profile.connect_latency.1.0.saturating_mul(4)
                } else {
                    0
                });
            self.schedule(
                at,
                Pending::Input(
                    key.0,
                    key.1,
                    SyncInput::Socket {
                        conn: ConnId(key.2),
                        event: SocketEvent::Closed {
                            code: 1006,
                            clean: false,
                        },
                    },
                ),
            );
            return Ok(());
        }
        let doc = link.doc;
        let claims = link
            .claims
            .clone()
            .ok_or_else(|| Failure::new("token_claims", "valid direct link has no claims"))?;
        let Some(server) = self.servers.get(&doc) else {
            return Err(Failure::new("document_route", "unknown document"));
        };
        if server.busy_until > self.clock.now
            || !server.inbox.is_empty()
            || server.ingress_scheduled
        {
            self.schedule(
                server.busy_until.max(self.clock.now.saturating_add(1)),
                Pending::Connect(key.0, key.1, key.2),
            );
            return Ok(());
        }
        let uuid = self.uuid();
        let socket = WebSocketId::new(uuid_value::Uuid::from_u128(uuid.as_u128()));
        let Some(server) = self.servers.get_mut(&doc) else {
            return Ok(());
        };
        let input = Input::Connect {
            grant: server.grant(claims.user, claims.access, claims.expires_at),
            key: server.key.clone(),
            socket: uuid_value::Uuid::from_u128(uuid.as_u128()),
        };
        let callback = server.step(SimServer::now(self.clock.wall(0), self.clock.now), input);
        let accepted = callback.accepted;
        let failed_upgrade = !accepted
            && callback.effects.iter().any(|effect| {
                effect.operation == "connections.accept"
                    && effect.value.as_str() == Some(socket.as_str())
            });
        if accepted && !callback.crashed {
            if let Some(link) = self.net.links.get_mut(&key) {
                link.open = true;
                link.socket = Some(socket.clone());
            }
            self.input(
                &key.0,
                key.1,
                SyncInput::Socket {
                    conn: ConnId(key.2),
                    event: SocketEvent::Opened,
                },
            )?;
        } else {
            self.input(
                &key.0,
                key.1,
                SyncInput::Socket {
                    conn: ConnId(key.2),
                    event: SocketEvent::Closed {
                        code: 1006,
                        clean: false,
                    },
                },
            )?;
        }
        self.callback(doc, callback)?;
        // An accepted server half may precede a fallible metadata write. If the
        // upgrade fails, the runtime closes that half even though no client link
        // opened. Run the actual close callback before removing runtime membership.
        if failed_upgrade {
            self.server_input(doc, Input::Runtime(ServerInput::Close(socket)))?;
        }
        Ok(())
    }
    fn deliver(
        &mut self,
        key: LinkKey,
        direction: Direction,
        delivery: Delivery,
    ) -> Result<(), Failure> {
        let valid = self.net.links.get(&key).is_some_and(|link| link.open)
            && !self.net.partitions.contains(&key.0)
            && !self.net.offline.contains(&key.0);
        if !valid {
            self.frame_fact(
                &key,
                direction,
                delivery.kind,
                &delivery.packet,
                "Lost",
                delivery.frames,
            );
            return Ok(());
        }
        self.frame_fact(
            &key,
            direction,
            delivery.kind,
            &delivery.packet,
            if delivery.corrupted {
                "Corrupted"
            } else {
                "Delivered"
            },
            delivery.frames,
        );
        if let Some(profile) = self.router_profile(&key) {
            return self.router_deliver(&profile, key, direction, delivery);
        }
        if direction == Direction::ToClient {
            if self.external_deliver(&key.0, delivery.packet.clone()) {
                return Ok(());
            }
            if let Packet::Binary(frame) = &delivery.packet
                && delivery.kind == FrameKind::Ack
                && self.clients.get(&key.0).is_some_and(|client| {
                    client.alive
                        && client.session == key.1
                        && client.connection_id() == Some(ConnId(key.2))
                })
                && let Some(bytes) = frame.get(1..)
                && let Ok(sync_protocol::FromRemote::RemoteUpdateAck { id }) =
                    sync_protocol::FromRemote::deserialize(bytes)
            {
                self.emit(Fact::AckReceived {
                    client: key.0.clone(),
                    update: id.into(),
                });
            }
            let event = match delivery.packet {
                Packet::Binary(frame) => SocketEvent::Frame(frame),
                Packet::Text(text) => SocketEvent::Text(text),
            };
            self.input(
                &key.0,
                key.1,
                SyncInput::Socket {
                    conn: ConnId(key.2),
                    event,
                },
            )
        } else {
            let Some(link) = self.net.links.get(&key) else {
                return Ok(());
            };
            let Some(socket) = link.socket.clone() else {
                return Ok(());
            };
            let doc = link.doc;
            let input = match delivery.packet {
                Packet::Binary(bytes) => ServerInput::Binary { socket, bytes },
                Packet::Text(text) => ServerInput::Text { socket, text },
            };
            self.server_input(doc, Input::Runtime(input))
        }
    }
    pub(super) fn server_input(&mut self, doc: DocIx, input: Input) -> Result<(), Failure> {
        let server = self
            .servers
            .get_mut(&doc)
            .ok_or_else(|| Failure::new("document_route", "unknown server"))?;
        if server.busy_until > self.clock.now
            || !server.inbox.is_empty()
            || server.ingress_scheduled
        {
            server.inbox.push_back(input);
            self.schedule_server_ingress(doc);
            return Ok(());
        }
        self.run_server_input(doc, input)
    }
    fn run_server_input(&mut self, doc: DocIx, input: Input) -> Result<(), Failure> {
        let closing = match &input {
            Input::Runtime(ServerInput::Close(socket)) => Some(socket.clone()),
            _ => None,
        };
        let server = self
            .servers
            .get_mut(&doc)
            .ok_or_else(|| Failure::new("document_route", "unknown server"))?;
        let callback = server.step(SimServer::now(self.clock.wall(0), self.clock.now), input);
        if let Some(socket) = closing {
            server.ports.runtime_closes(&socket);
        }
        self.callback(doc, callback)?;
        self.schedule_server_ingress(doc);
        Ok(())
    }
    fn schedule_server_ingress(&mut self, doc: DocIx) {
        if let Some(server) = self.servers.get_mut(&doc) {
            if server.inbox.is_empty() || server.ingress_scheduled {
                return;
            }
            server.ingress_generation = server.ingress_generation.saturating_add(1);
            server.ingress_scheduled = true;
            let generation = server.ingress_generation;
            let at = server.busy_until.max(self.clock.now);
            self.schedule(at, Pending::ServerReady(doc, generation));
        }
    }
    pub(super) fn callback(&mut self, doc: DocIx, callback: Callback) -> Result<(), Failure> {
        let Callback {
            index,
            effects,
            generation,
            blocking,
            updates,
            facts,
            error,
            crashed,
            accepted: _,
        } = callback;
        for fact in facts {
            self.emit(fact);
        }
        if let Some(server) = self.servers.get(&doc) {
            let directory = server.ports.directory_dump();
            let mapped = directory["peer_user_map"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|row| row["peer_id"].as_str().and_then(|peer| peer.parse().ok()))
                .collect();
            self.emit(Fact::DirectoryState {
                doc,
                callback: index,
                mapped,
            });
        }
        if let Some(error) = error {
            if error.invariant != "server_callback" || error.detail.contains("stalled") {
                self.fail(Failure::new("server_stalled", error));
            } else {
                self.emit(Fact::Server {
                    operation: format!("callback_error: {}", error.detail),
                });
            }
        }
        if crashed {
            self.server_effects(doc, index, effects)?;
            if let Some(server) = self.servers.get_mut(&doc) {
                server.ports.recover();
                server.evict();
                server.epoch = server.epoch.saturating_add(1);
                server.pending_durable = 0;
                server.completions.clear();
                server.alarm_generation = server.alarm_generation.saturating_add(1);
                self.scheduled_generation
                    .insert(doc, server.ports.write_generation());
            }
            self.ack_callbacks.retain(|(target, _), _| *target != doc);
            self.emit(Fact::Server {
                operation: "crashed".into(),
            });
            return Ok(());
        }
        let scheduled = self.scheduled_generation.get(&doc).copied().unwrap_or(0);
        if generation > scheduled {
            self.scheduled_generation.insert(doc, generation);
            if let Some(server) = self.servers.get_mut(&doc) {
                server
                    .completions
                    .insert(generation, (index, blocking, updates.clone()));
                let at = server
                    .busy_until
                    .max(self.clock.now)
                    .saturating_add(server.storage_latency.0);
                let epoch = server.epoch;
                self.schedule(at, Pending::ServerDurable(doc, epoch, generation, index));
            }
        }
        // Register this callback before delivering its outputs: a successful close
        // can synchronously enter another callback with a newer write generation.
        self.server_effects(doc, index, effects)?;
        self.schedule_alarm(doc);
        Ok(())
    }
    fn schedule_alarm(&mut self, doc: DocIx) {
        if let Some(server) = self.servers.get_mut(&doc)
            && let Some(wall) = server.ports.alarm_dump()
        {
            let at = self.clock.now.saturating_add(
                u64::try_from(wall.saturating_sub(self.clock.wall(0))).unwrap_or(0),
            );
            server.alarm_generation = server.alarm_generation.saturating_add(1);
            let generation = server.alarm_generation;
            self.schedule(at, Pending::Alarm(doc, generation));
        }
    }
    fn server_effects(
        &mut self,
        doc: DocIx,
        callback: u64,
        effects: Vec<Effect>,
    ) -> Result<(), Failure> {
        let closes = self
            .servers
            .get(&doc)
            .map(|server| server.ports.take_completed_closes())
            .unwrap_or_default();
        let queued = self
            .servers
            .get(&doc)
            .map(|server| server.ports.take_queued_sends())
            .unwrap_or_default();
        for effect in queued {
            if effect.operation != "send" {
                continue;
            }
            let frame = serde_json::from_value::<Vec<u8>>(effect.value["frame"].clone())
                .map_err(|error| Failure::new("queued_send", error))?;
            if let Some(message) = frame.get(1..)
                && let Ok(sync_protocol::FromRemote::RemoteUpdateAck { id }) =
                    sync_protocol::FromRemote::deserialize(message)
            {
                self.ack_callbacks
                    .entry((doc, id.into()))
                    .or_default()
                    .push_back(callback);
            }
        }
        let mut proofs = self
            .servers
            .get(&doc)
            .map(|server| server.ports.take_delivery_proofs())
            .unwrap_or_default()
            .into_iter();
        for effect in effects {
            if effect.operation == "send" || effect.operation == "send_text" {
                let (required, confirmed) = proofs.next().ok_or_else(|| {
                    Failure::new("output_gate_evidence", "send without an output-gate proof")
                })?;
                self.emit(Fact::GateReleased {
                    doc,
                    callback,
                    required,
                    confirmed,
                });
            }
            if effect.operation == "send" {
                let frame = serde_json::from_value::<Vec<u8>>(effect.value["frame"].clone())
                    .map_err(|e| Failure::new("server_frame", e))?;
                let message = frame.get(1..).unwrap_or_default();
                if let Ok(sync_protocol::FromRemote::RemoteUpdateAck { id }) =
                    sync_protocol::FromRemote::deserialize(message)
                {
                    let source = self
                        .ack_callbacks
                        .get_mut(&(doc, id.into()))
                        .and_then(std::collections::VecDeque::pop_front)
                        .ok_or_else(|| {
                            Failure::new("ack_evidence", "released ack has no original attempt")
                        })?;
                    self.emit(Fact::AckSent {
                        update: id.into(),
                        callback: source,
                    });
                }
            }
            self.server_ports.push(ServerPort {
                doc,
                callback,
                effect: effect.clone(),
            });
            if effect.operation == "send" || effect.operation == "send_text" {
                let socket = effect.value["socket"].as_str().unwrap_or("");
                if effect.operation == "send" {
                    let frame = serde_json::from_value::<Vec<u8>>(effect.value["frame"].clone())
                        .map_err(|error| Failure::new("server_frame", error))?;
                    if self.router_server_frame(socket, &frame)? {
                        continue;
                    }
                }
                let key = self
                    .net
                    .links
                    .iter()
                    .find(|(_, link)| {
                        link.doc == doc
                            && link.socket.as_ref().is_some_and(|id| id.as_str() == socket)
                    })
                    .map(|(key, _)| key.clone());
                if let Some(key) = key {
                    let (packet, category) = if effect.operation == "send" {
                        let frame =
                            serde_json::from_value::<Vec<u8>>(effect.value["frame"].clone())
                                .map_err(|e| Failure::new("server_frame", e))?;
                        let link = self
                            .net
                            .links
                            .get_mut(&key)
                            .ok_or_else(|| Failure::new("network_link", "lost server link"))?;
                        if let Some(message) = link
                            .down
                            .push(&frame)
                            .map_err(|e| Failure::new("server_framing", e))?
                        {
                            link.down_kind = kind(&message, Direction::ToClient);
                        }
                        (Packet::Binary(frame), link.down_kind)
                    } else {
                        (
                            Packet::Text(effect.value["text"].as_str().unwrap_or("").into()),
                            FrameKind::Pong,
                        )
                    };
                    self.transmit(key, Direction::ToClient, category, packet);
                }
            }
        }
        for (socket, code) in closes {
            self.router_server_close(&socket)?;
            let keys = self
                .net
                .links
                .iter()
                .filter(|(_, link)| link.doc == doc && link.socket.as_ref() == Some(&socket))
                .map(|(key, _)| key.clone())
                .collect::<Vec<_>>();
            for key in keys {
                self.break_link(&key, code)?;
            }
        }
        if proofs.next().is_some() {
            return Err(Failure::new(
                "output_gate_evidence",
                "unmatched output-gate proof",
            ));
        }
        Ok(())
    }
    pub(super) fn break_link(&mut self, key: &LinkKey, code: u16) -> Result<(), Failure> {
        let Some(link) = self.net.links.get_mut(key) else {
            return Ok(());
        };
        if !link.open {
            return Ok(());
        }
        if let Some(profile) = self.router_profile(key) {
            return self.router_break(&profile, code);
        }
        let Some(link) = self.net.links.get_mut(key) else {
            return Ok(());
        };
        link.open = false;
        let doc = link.doc;
        let socket = link.socket.clone();
        // Close callbacks run while the native runtime still lists the socket.
        if let Some(socket) = socket {
            self.server_input(doc, Input::Runtime(ServerInput::Close(socket.clone())))?;
        }
        if self.external_closed(&key.0, code) {
            return Ok(());
        }
        self.input(
            &key.0,
            key.1,
            SyncInput::Socket {
                conn: ConnId(key.2),
                event: SocketEvent::Closed {
                    code,
                    clean: code != 1006,
                },
            },
        )?;
        Ok(())
    }
}
