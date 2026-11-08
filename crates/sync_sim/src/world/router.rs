//! One real client RouterCore per profile; a protocol fake owns downstream dialing.
use super::*;
use crate::{
    network::{Delivery, Link},
    router::Action,
};
use bebop::Record;
use doc_sync_core::{
    Now, RouteEvent, RouterConfig, RouterCore, RouterInput, RouterOutput, TokenEvent, WriteAccess,
};
use sync_protocol::framing::Reassembler;
use sync_server_core::domain::socket::WebSocketId;

pub(super) struct Host {
    core: RouterCore,
    protocol: SimRouter,
    owner: ClientName,
    session: SessionId,
    pub(super) generation: u64,
    members: BTreeMap<String, BTreeSet<ClientName>>,
    pub authority: BTreeMap<String, ClientName>,
    sockets: BTreeMap<String, (u64, DocIx, WebSocketId)>,
}
impl Sim {
    pub(super) fn router_profile(&self, key: &LinkKey) -> Option<ProfileName> {
        self.routers
            .iter()
            .find(|(_, host)| host.owner == key.0 && host.session == key.1)
            .map(|(profile, _)| profile.clone())
    }
    pub(super) fn router_attach(&mut self, name: &ClientName) -> Result<(), Failure> {
        let client = self
            .clients
            .get(name)
            .ok_or_else(|| Failure::new("router_owner", "missing client"))?;
        let profile = client.spec.profile.clone();
        let doc = client.core_doc_id();
        if !self.routers.contains_key(&profile) {
            let session = SessionId(self.uuid());
            self.routers.insert(
                profile.clone(),
                Host {
                    core: RouterCore::new(
                        RouterConfig {
                            timeouts: self.config.session.timeouts,
                            heartbeat: self.config.session.heartbeat,
                            backoff: self.config.session.backoff,
                            traceparent: None,
                        },
                        self.router_now(),
                    ),
                    protocol: SimRouter::default(),
                    owner: name.clone(),
                    session,
                    generation: 0,
                    members: BTreeMap::new(),
                    authority: BTreeMap::new(),
                    sockets: BTreeMap::new(),
                },
            );
        }
        self.router_input(&profile, RouterInput::Tick)?;
        let host = self
            .routers
            .get_mut(&profile)
            .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
        host.members
            .entry(doc.to_string())
            .or_default()
            .insert(name.clone());
        host.authority.insert(doc.to_string(), name.clone());
        let mut out = RouterOutput::default();
        host.core.attach(doc, None, &mut out);
        self.router_output(&profile, out)
    }
    pub(super) fn router_detach(&mut self, name: &ClientName) -> Result<(), Failure> {
        let Some(client) = self.clients.get(name) else {
            return Ok(());
        };
        let profile = client.spec.profile.clone();
        let doc = client.core_doc_id();
        let Some(host) = self.routers.get_mut(&profile) else {
            return Ok(());
        };
        let removed = host
            .members
            .get_mut(doc.as_str())
            .is_some_and(|members| members.remove(name));
        if !removed {
            return Ok(());
        }
        if host
            .members
            .get(doc.as_str())
            .is_some_and(BTreeSet::is_empty)
        {
            host.members.remove(doc.as_str());
            host.authority.remove(doc.as_str());
        } else if host.authority.get(doc.as_str()) == Some(name)
            && let Some(next) = host
                .members
                .get(doc.as_str())
                .and_then(|members| members.first())
                .cloned()
        {
            host.authority.insert(doc.to_string(), next);
        }
        let mut out = RouterOutput::default();
        host.core.detach(&doc, &mut out);
        self.router_output(&profile, out)
    }
    fn router_now(&self) -> Now {
        Now {
            mono: doc_sync_core::Millis(self.clock.now),
            wall: doc_sync_core::UnixMillis(self.clock.wall(0)),
        }
    }
    pub(super) fn router_input(
        &mut self,
        profile: &ProfileName,
        input: RouterInput,
    ) -> Result<(), Failure> {
        let now = self.router_now();
        let Some(host) = self.routers.get_mut(profile) else {
            return Ok(());
        };
        let mut out = RouterOutput::default();
        host.core.handle(now, input, &mut out);
        self.router_output(profile, out)
    }
    fn router_output(&mut self, profile: &ProfileName, out: RouterOutput) -> Result<(), Failure> {
        let Some(host) = self.routers.get_mut(profile) else {
            return Ok(());
        };
        host.generation = host.generation.saturating_add(1);
        let generation = host.generation;
        if let Some(at) = out.wake_at {
            self.schedule(at.0, Pending::RouterWake(profile.clone(), generation));
        }
        for effect in out.io {
            match effect {
                IoEffect::RouterConnect { conn, .. } => {
                    let host = self
                        .routers
                        .get(profile)
                        .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
                    let key = (host.owner.clone(), host.session, conn.0);
                    self.net.links.insert(
                        key,
                        Link {
                            socket: None,
                            open: false,
                            doc: DocIx(0),
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
                    self.emit(Fact::RouterSocket {
                        profile: profile.clone(),
                        connection: conn.0,
                        open: false,
                    });
                    let at = self.clock.now.saturating_add(crate::clock::delay(
                        self.net.profile.connect_latency,
                        &mut self.rng,
                    ));
                    self.schedule(at, Pending::RouterConnect(profile.clone(), conn.0));
                }
                IoEffect::SocketSend { conn, frame } => {
                    let host = self
                        .routers
                        .get(profile)
                        .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
                    let kind = envelope_kind(&frame, Direction::ToServer);
                    self.transmit(
                        (host.owner.clone(), host.session, conn.0),
                        Direction::ToServer,
                        kind,
                        Packet::Binary(frame),
                    );
                }
                IoEffect::SocketPing { conn } => {
                    let host = self
                        .routers
                        .get(profile)
                        .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
                    self.transmit(
                        (host.owner.clone(), host.session, conn.0),
                        Direction::ToServer,
                        FrameKind::Ping,
                        Packet::Text("ping".into()),
                    );
                }
                IoEffect::SocketClose { conn, code, .. } => {
                    self.router_close(profile, conn, code)?
                }
                IoEffect::FetchToken { attempt, doc } => {
                    let name = self
                        .routers
                        .get(profile)
                        .and_then(|host| host.authority.get(doc.as_str()))
                        .cloned();
                    let offline = self
                        .routers
                        .get(profile)
                        .is_some_and(|host| self.net.offline.contains(&host.owner));
                    let event = if let Some(client) = name
                        .as_ref()
                        .and_then(|name| self.clients.get_mut(name))
                        .filter(|client| client.alive)
                    {
                        let failed = client.token_failures > 0 || offline;
                        client.token_failures = client.token_failures.saturating_sub(1);
                        if failed {
                            TokenEvent::Failed { attempt }
                        } else {
                            let token = format!("sim-route-token-{}-{attempt}", client.session.0);
                            self.tokens.insert(
                                token.clone(),
                                crate::model::TokenGrant::issue(client, self.clock.wall(0)),
                            );
                            TokenEvent::Fetched {
                                attempt,
                                token: doc_sync_core::SyncToken::new(token),
                                access: write_access(client.spec.access),
                            }
                        }
                    } else {
                        TokenEvent::Failed { attempt }
                    };
                    let at = self
                        .clock
                        .now
                        .saturating_add(self.rng.random_range(20..=200));
                    self.schedule(at, Pending::RouterToken(profile.clone(), doc, event));
                }
                _ => return Err(Failure::new("router_executor", "unexpected router effect")),
            }
        }
        for (doc, event) in out.to_sessions {
            let targets = self
                .routers
                .get(profile)
                .and_then(|host| host.members.get(doc.as_str()))
                .cloned()
                .unwrap_or_default();
            for name in targets {
                if let Some(client) = self.clients.get(&name).filter(|client| client.alive) {
                    let session = client.session;
                    if let RouteEvent::Frame { frame, .. } = &event
                        && let Some(bytes) = frame.get(1..)
                        && let Ok(sync_protocol::FromRemote::RemoteUpdateAck { id }) =
                            sync_protocol::FromRemote::deserialize(bytes)
                    {
                        self.emit(Fact::AckReceived {
                            client: name.clone(),
                            update: id.into(),
                        });
                    }
                    self.input(&name, session, SyncInput::Route(event.clone()))?;
                }
            }
        }
        Ok(())
    }
    pub(super) fn router_connect(
        &mut self,
        profile: &ProfileName,
        conn: u32,
    ) -> Result<(), Failure> {
        let Some(host) = self.routers.get(profile) else {
            return Ok(());
        };
        let key = (host.owner.clone(), host.session, conn);
        if !matches!(host.core.connection(), doc_sync_core::Connection::Connecting { conn: current, .. } if current.0 == conn)
        {
            return Ok(());
        }
        if self.net.partitions.contains(&key.0) {
            return Ok(());
        }
        if self.net.offline.contains(&key.0) {
            let at = self
                .clock
                .now
                .saturating_add(self.net.profile.connect_latency.1.0.saturating_mul(4));
            self.schedule(at, Pending::RouterClose(profile.clone(), conn, 1006));
            return Ok(());
        }
        if let Some(link) = self.net.links.get_mut(&key) {
            link.open = true;
        }
        self.emit(Fact::RouterSocket {
            profile: profile.clone(),
            connection: conn,
            open: true,
        });
        self.router_input(
            profile,
            RouterInput::Socket {
                conn: ConnId(conn),
                event: SocketEvent::Opened,
            },
        )
    }
    pub(super) fn router_send(&mut self, name: &ClientName, frame: Vec<u8>) -> Result<(), Failure> {
        let Some(client) = self.clients.get_mut(name) else {
            return Ok(());
        };
        let message = client
            .outgoing
            .push(&frame)
            .map_err(|error| Failure::new("outbound_framing", error))?;
        let doc = client.core_doc_id();
        let profile = client.spec.profile.clone();
        let session = client.session;
        if let Some(message) = message {
            self.observe_push(name, session, &message)?;
        }
        self.router_input(&profile, RouterInput::Send { doc, frame })
    }
    pub(super) fn router_deliver(
        &mut self,
        profile: &ProfileName,
        key: LinkKey,
        direction: Direction,
        delivery: Delivery,
    ) -> Result<(), Failure> {
        if direction == Direction::ToClient {
            let event = match delivery.packet {
                Packet::Binary(frame) => SocketEvent::Frame(frame),
                Packet::Text(text) => SocketEvent::Text(text),
            };
            return self.router_input(
                profile,
                RouterInput::Socket {
                    conn: ConnId(key.2),
                    event,
                },
            );
        }
        match delivery.packet {
            Packet::Text(text) if text == "ping" => self.transmit(
                key,
                Direction::ToClient,
                FrameKind::Pong,
                Packet::Text("pong".into()),
            ),
            Packet::Text(_) => {}
            Packet::Binary(bytes) => {
                let actions = self
                    .routers
                    .get_mut(profile)
                    .ok_or_else(|| Failure::new("router_owner", "missing host"))?
                    .protocol
                    .receive(&bytes)?;
                self.router_actions(profile, actions)?;
            }
        }
        Ok(())
    }
    fn router_actions(
        &mut self,
        profile: &ProfileName,
        actions: Vec<Action>,
    ) -> Result<(), Failure> {
        for action in actions {
            match action {
                Action::Open { doc, token, epoch } => {
                    let at = self.clock.now.saturating_add(crate::clock::delay(
                        self.net.profile.connect_latency,
                        &mut self.rng,
                    ));
                    self.schedule(
                        at,
                        Pending::RouteConnect(profile.clone(), doc, epoch, token),
                    );
                }
                Action::Cancel { doc, epoch } => {
                    let socket = self.routers.get_mut(profile).and_then(|host| {
                        if host
                            .sockets
                            .get(&doc)
                            .is_some_and(|(current, _, _)| *current == epoch)
                        {
                            host.sockets.remove(&doc)
                        } else {
                            None
                        }
                    });
                    if let Some((_, index, socket)) = socket {
                        self.server_input(index, Input::Runtime(ServerInput::Close(socket)))?;
                    }
                }
                Action::Deliver(bytes) => self.router_down(profile, bytes)?,
                Action::Pump { doc, epoch } => {
                    let host = self
                        .routers
                        .get_mut(profile)
                        .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
                    if let Some((_, index, socket)) = host
                        .sockets
                        .get(&doc)
                        .filter(|(current, _, _)| *current == epoch)
                        .cloned()
                    {
                        for bytes in host.protocol.drain(&doc, epoch) {
                            self.server_input(
                                index,
                                Input::Runtime(ServerInput::Binary {
                                    socket: socket.clone(),
                                    bytes,
                                }),
                            )?;
                        }
                    }
                }
            }
        }
        Ok(())
    }
    fn router_down(&mut self, profile: &ProfileName, bytes: Vec<u8>) -> Result<(), Failure> {
        let Some(host) = self.routers.get(profile) else {
            return Ok(());
        };
        let Some(conn) = physical_conn(host.core.connection()) else {
            return Ok(());
        };
        let kind = envelope_kind(&bytes, Direction::ToClient);
        self.transmit(
            (host.owner.clone(), host.session, conn.0),
            Direction::ToClient,
            kind,
            Packet::Binary(bytes),
        );
        Ok(())
    }
    pub(super) fn route_connect(
        &mut self,
        profile: &ProfileName,
        doc: String,
        epoch: u64,
        token: String,
    ) -> Result<(), Failure> {
        if !self
            .routers
            .get(profile)
            .is_some_and(|host| host.protocol.current(&doc, epoch))
        {
            return Ok(());
        }
        let index = self
            .servers
            .iter()
            .find(|(_, server)| server.key.as_str() == doc)
            .map(|(index, _)| *index);
        let Some(index) = index else {
            return self.route_failed(profile, &doc, epoch);
        };
        let server = self
            .servers
            .get(&index)
            .ok_or_else(|| Failure::new("router_document", "missing server"))?;
        if server.busy_until > self.clock.now
            || server.ingress_scheduled
            || !server.inbox.is_empty()
        {
            let at = server.busy_until.max(self.clock.now.saturating_add(1));
            self.schedule(
                at,
                Pending::RouteConnect(profile.clone(), doc, epoch, token),
            );
            return Ok(());
        }
        let name = self
            .routers
            .get(profile)
            .and_then(|host| host.authority.get(&doc))
            .cloned();
        let Some(client) = name
            .as_ref()
            .and_then(|name| self.clients.get_mut(name))
            .filter(|client| client.alive)
        else {
            return self.route_failed(profile, &doc, epoch);
        };
        let valid = !std::mem::take(&mut client.expire_token);
        let Some(claims) = self.tokens.get(&token).cloned().filter(|claims| {
            valid && claims.doc.as_str() == doc && !claims.expired(self.clock.wall(0))
        }) else {
            return self.route_failed(profile, &doc, epoch);
        };
        let socket = self.uuid();
        let now = SimServer::now(self.clock.wall(0), self.clock.now);
        let server = self
            .servers
            .get_mut(&index)
            .ok_or_else(|| Failure::new("router_document", "missing server"))?;
        let input = Input::Connect {
            grant: server.grant(claims.user, claims.access, claims.expires_at),
            key: server.key.clone(),
            socket,
        };
        let callback = server.step(now, input);
        let accepted = callback.accepted;
        let failed_upgrade = !accepted
            && callback.effects.iter().any(|effect| {
                effect.operation == "connections.accept"
                    && effect.value.as_str() == Some(WebSocketId::new(socket).as_str())
            });
        let mut pumps = Vec::new();
        if accepted {
            let host = self
                .routers
                .get_mut(profile)
                .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
            host.sockets
                .insert(doc.clone(), (epoch, index, WebSocketId::new(socket)));
            let actions = host.protocol.ready(&doc, epoch)?;
            // The upstream handshake is acknowledged before initial-sync bytes.
            // Record the completed connect callback before executing any queued input.
            let (deliveries, pending): (Vec<_>, Vec<_>) = actions
                .into_iter()
                .partition(|action| matches!(action, Action::Deliver(_)));
            pumps = pending;
            self.router_actions(profile, deliveries)?;
        }
        self.callback(index, callback)?;
        self.router_actions(profile, pumps)?;
        if failed_upgrade {
            self.server_input(
                index,
                Input::Runtime(ServerInput::Close(WebSocketId::new(socket))),
            )?;
        }
        if !accepted {
            self.route_failed(profile, &doc, epoch)?;
        }
        Ok(())
    }
    fn route_failed(
        &mut self,
        profile: &ProfileName,
        doc: &str,
        epoch: u64,
    ) -> Result<(), Failure> {
        let host = self
            .routers
            .get_mut(profile)
            .ok_or_else(|| Failure::new("router_owner", "missing host"))?;
        let actions = host.protocol.closed(doc, epoch, true)?;
        self.router_actions(profile, actions)
    }
    pub(super) fn router_server_frame(
        &mut self,
        socket: &str,
        frame: &[u8],
    ) -> Result<bool, Failure> {
        let target = self.routers.iter().find_map(|(profile, host)| {
            host.sockets
                .iter()
                .find(|(_, (_, _, id))| id.as_str() == socket)
                .map(|(doc, (epoch, _, _))| (profile.clone(), doc.clone(), *epoch))
        });
        let Some((profile, doc, epoch)) = target else {
            return Ok(false);
        };
        if let Some(bytes) = self
            .routers
            .get(&profile)
            .ok_or_else(|| Failure::new("router_owner", "missing host"))?
            .protocol
            .frame(&doc, epoch, frame)?
        {
            self.router_down(&profile, bytes)?;
        }
        Ok(true)
    }
    pub(super) fn router_server_close(&mut self, socket: &WebSocketId) -> Result<(), Failure> {
        let target = self.routers.iter().find_map(|(profile, host)| {
            host.sockets
                .iter()
                .find(|(_, (_, _, id))| id == socket)
                .map(|(doc, (epoch, _, _))| (profile.clone(), doc.clone(), *epoch))
        });
        if let Some((profile, doc, epoch)) = target {
            let actions = self
                .routers
                .get_mut(&profile)
                .ok_or_else(|| Failure::new("router_owner", "missing host"))?
                .protocol
                .closed(&doc, epoch, false)?;
            self.router_actions(&profile, actions)?;
        }
        Ok(())
    }
    pub(super) fn router_break(&mut self, profile: &ProfileName, code: u16) -> Result<(), Failure> {
        let conn = self
            .routers
            .get(profile)
            .and_then(|host| physical_conn(host.core.connection()));
        if let Some(conn) = conn {
            self.router_close(profile, conn, code)?;
        }
        Ok(())
    }
    pub(super) fn router_close(
        &mut self,
        profile: &ProfileName,
        conn: ConnId,
        code: u16,
    ) -> Result<(), Failure> {
        let Some(host) = self.routers.get_mut(profile) else {
            return Ok(());
        };
        let key = (host.owner.clone(), host.session, conn.0);
        if let Some(link) = self.net.links.get_mut(&key) {
            link.open = false;
        }
        if physical_conn(host.core.connection()).is_some_and(|current| current != conn) {
            return Ok(());
        }
        let actions = host.protocol.disconnect();
        self.router_actions(profile, actions)?;
        self.emit(Fact::RouterSocket {
            profile: profile.clone(),
            connection: conn.0,
            open: false,
        });
        self.router_input(
            profile,
            RouterInput::Socket {
                conn,
                event: SocketEvent::Closed {
                    code,
                    clean: code != 1006,
                },
            },
        )
    }
    pub(super) fn network_name(&self, name: &ClientName) -> ClientName {
        self.clients
            .get(name)
            .filter(|client| client.routed)
            .and_then(|client| self.routers.get(&client.spec.profile))
            .map(|host| host.owner.clone())
            .unwrap_or_else(|| name.clone())
    }
    pub(super) fn router_network_fault(&self, fault: NetStep) -> NetStep {
        match fault {
            NetStep::Partition(name) => NetStep::Partition(self.network_name(&name)),
            NetStep::Heal(name) => NetStep::Heal(self.network_name(&name)),
            NetStep::Break(name) => NetStep::Break(name),
            NetStep::LoseAcks { client, count } => NetStep::LoseAcks {
                client: self.network_name(&client),
                count,
            },
            NetStep::DropNext {
                client,
                direction,
                kind,
                frames,
            } => NetStep::DropNext {
                client: self.network_name(&client),
                direction,
                kind,
                frames,
            },
            NetStep::CorruptNext { client, direction } => NetStep::CorruptNext {
                client: self.network_name(&client),
                direction,
            },
            NetStep::Profile(profile) => NetStep::Profile(profile),
        }
    }
    pub(super) fn routed_open(&self, name: &ClientName) -> bool {
        self.clients.get(name).is_some_and(|client| {
            self.routers.get(&client.spec.profile).is_some_and(|host| {
                physical_conn(host.core.connection()).is_some_and(|conn| {
                    self.net
                        .links
                        .get(&(host.owner.clone(), host.session, conn.0))
                        .is_some_and(|link| link.open)
                }) && host
                    .members
                    .get(client.doc_id.as_str())
                    .is_some_and(|members| members.contains(name))
            })
        })
    }
}
fn physical_conn(connection: &doc_sync_core::Connection) -> Option<ConnId> {
    match connection {
        doc_sync_core::Connection::Connecting { conn, .. }
        | doc_sync_core::Connection::AwaitingInitialSync { conn, .. }
        | doc_sync_core::Connection::Synced { conn, .. }
        | doc_sync_core::Connection::Authorizing { conn, .. } => Some(*conn),
        _ => None,
    }
}
fn write_access(access: Access) -> WriteAccess {
    match access {
        Access::Edit => WriteAccess::Full,
        Access::CommentOnly => WriteAccess::CommentMarks,
        Access::Read => WriteAccess::None,
    }
}
fn envelope_kind(bytes: &[u8], direction: Direction) -> FrameKind {
    let frame = match direction {
        Direction::ToServer => match sync_protocol::ToRouter::deserialize(bytes) {
            Ok(sync_protocol::ToRouter::RouterFrame { payload, .. }) => {
                Some(payload.iter().collect::<Vec<_>>())
            }
            _ => None,
        },
        Direction::ToClient => match sync_protocol::FromRouter::deserialize(bytes) {
            Ok(sync_protocol::FromRouter::RouterDocFrame { payload, .. }) => {
                Some(payload.iter().collect::<Vec<_>>())
            }
            _ => None,
        },
    };
    frame
        .and_then(|frame| {
            frame
                .get(1..)
                .map(|message| crate::network::kind(message, direction))
        })
        .unwrap_or(FrameKind::Unknown)
}

#[cfg(test)]
mod test;
