//! Shared router socket with independent route authorization and frame assembly.

use crate::connection::{ConnectionMachine, ConnectionSettings, ConnectionTarget};
use crate::*;
use bebop::{Record, SliceWrapper};
use std::collections::{BTreeMap, VecDeque};

/// Policies for the shared router socket.
#[derive(Clone, Debug, Default)]
pub struct RouterConfig {
    /// Per-operation time limits.
    pub timeouts: Timeouts,
    /// Socket heartbeat policy.
    pub heartbeat: HeartbeatPolicy,
    /// Physical reconnect policy.
    pub backoff: BackoffPolicy,
    /// Trace context propagated by the host.
    pub traceparent: Option<String>,
}

/// Inputs from the host or a document session.
pub enum RouterInput {
    /// A callback from the current physical socket.
    Socket {
        /// Socket generation.
        conn: ConnId,
        /// Host callback.
        event: SocketEvent,
    },
    /// Per-document authorization result.
    Token {
        /// Route being authorized.
        doc: SyncDocId,
        /// Token attempt result.
        event: TokenEvent,
    },
    /// A framed document-protocol payload to forward.
    Send {
        /// Destination route.
        doc: SyncDocId,
        /// One inner frame, including its final flag.
        frame: Vec<u8>,
    },
    /// Refresh one route's token and subscription.
    Reconnect(SyncDocId),
    /// Network or page lifecycle signal.
    Host(HostSignal),
    /// The shared host timer fired.
    Tick,
}

/// Ordered socket effects and callbacks for attached document sessions.
#[derive(Default)]
pub struct RouterOutput {
    /// Host effects for the physical socket and token fetcher.
    pub io: Vec<IoEffect>,
    /// Route-scoped callbacks in deterministic document order.
    pub to_sessions: Vec<(SyncDocId, RouteEvent)>,
    /// Earliest physical or per-route deadline.
    pub wake_at: Option<Millis>,
}

#[derive(Clone, Copy)]
enum RouteState {
    Authorizing(u32),
    Subscribing,
    Open,
    Dropped { at: Millis },
    Closed,
}
struct Route {
    owners: usize,
    state: RouteState,
    generation: ConnId,
    pending: VecDeque<Vec<u8>>,
    initial_token: Option<SyncToken>,
    access: WriteAccess,
    delay: Millis,
    reassembler: sync_protocol::framing::Reassembler,
    deadline: Option<Millis>,
}

/// One shared router connection; route keys are always traversed in sorted order.
pub struct RouterCore {
    connection: ConnectionMachine,
    routes: BTreeMap<SyncDocId, Route>,
    now: Now,
    next_attempt: u32,
    next_route: u32,
    subscribe_timeout: Millis,
}

impl RouterCore {
    /// Create a router without opening a socket until the first route is attached.
    pub fn new(config: RouterConfig, now: Now) -> Self {
        Self {
            subscribe_timeout: config.timeouts.initial_sync,
            connection: ConnectionMachine::new(ConnectionSettings {
                target: ConnectionTarget::Router,
                timeouts: config.timeouts,
                heartbeat: config.heartbeat,
                backoff: config.backoff,
                initial_token: None,
                initial_access: WriteAccess::Full,
                traceparent: config.traceparent,
            }),
            routes: BTreeMap::new(),
            now,
            next_attempt: 0,
            next_route: 0,
        }
    }

    /// Attach another owner. Joining an open route deliberately resubscribes it.
    pub fn attach(
        &mut self,
        doc: SyncDocId,
        initial_token: Option<SyncToken>,
        out: &mut RouterOutput,
    ) {
        self.clear_output(out);
        if let Some(route) = self.routes.get_mut(&doc) {
            route.owners = route.owners.saturating_add(1);
            out.to_sessions.push((
                doc.clone(),
                RouteEvent::Closed {
                    conn: route.generation,
                    code: 4000,
                },
            ));
            route.state = RouteState::Closed;
            route.reassembler = sync_protocol::framing::Reassembler::default();
            route.pending.clear();
            if initial_token.is_some() {
                route.initial_token = initial_token;
            }
        } else {
            self.routes.insert(
                doc.clone(),
                Route {
                    owners: 1,
                    state: RouteState::Closed,
                    generation: ConnId(0),
                    pending: VecDeque::new(),
                    initial_token,
                    access: WriteAccess::Full,
                    delay: Millis(500),
                    reassembler: sync_protocol::framing::Reassembler::default(),
                    deadline: None,
                },
            );
        }
        if matches!(
            self.connection.state,
            Connection::Idle | Connection::GaveUp { .. }
        ) {
            self.connection.start(self.now, false, &mut out.io);
        }
        if self.connection.synced() {
            self.subscribe(&doc, out);
        }
        self.set_wake(out);
    }

    /// Release an owner; only the final release unsubscribes the route.
    pub fn detach(&mut self, doc: &SyncDocId, out: &mut RouterOutput) {
        self.clear_output(out);
        let Some(route) = self.routes.get_mut(doc) else {
            return;
        };
        route.owners = route.owners.saturating_sub(1);
        if route.owners == 0 {
            self.routes.remove(doc);
            self.send(
                sync_protocol::ToRouter::RouterUnsubscribe {
                    doc_id: doc.as_str(),
                },
                out,
            );
        }
        if self.routes.is_empty() {
            self.connection.close(CloseReason::Stopped, &mut out.io);
            self.connection.state = Connection::Idle;
        }
        self.set_wake(out);
    }

    /// Current physical socket state.
    pub fn connection(&self) -> &Connection {
        &self.connection.state
    }

    /// Handle a host event or outgoing inner frame. No I/O is performed here.
    pub fn handle(&mut self, now: Now, input: RouterInput, out: &mut RouterOutput) {
        self.now = now;
        self.clear_output(out);
        match input {
            RouterInput::Socket { conn, event } if self.connection.conn() == Some(conn) => {
                let opened = matches!(event, SocketEvent::Opened);
                let closed = matches!(event, SocketEvent::Closed { .. });
                self.connection.socket(conn, &event, now, &mut out.io);
                if opened && self.connection.synced() {
                    let docs: Vec<_> = self.routes.keys().cloned().collect();
                    for doc in docs {
                        self.subscribe(&doc, out);
                    }
                }
                if closed {
                    self.disconnect_routes(out);
                }
                if let SocketEvent::Frame(bytes) = event {
                    self.incoming(&bytes, out);
                }
            }
            RouterInput::Token { doc, event } => self.token(doc, event, out),
            RouterInput::Send { doc, frame } => {
                if let Some(route) = self.routes.get_mut(&doc) {
                    if matches!(route.state, RouteState::Open) && self.connection.synced() {
                        self.send(
                            sync_protocol::ToRouter::RouterFrame {
                                doc_id: doc.as_str(),
                                payload: SliceWrapper::from_cooked(&frame),
                            },
                            out,
                        );
                    } else if matches!(
                        route.state,
                        RouteState::Authorizing(_) | RouteState::Subscribing
                    ) {
                        route.pending.push_back(frame);
                    }
                }
            }
            RouterInput::Reconnect(doc) => self.subscribe(&doc, out),
            RouterInput::Host(HostSignal::Online | HostSignal::Visible) => {
                if !self.routes.is_empty()
                    && matches!(
                        self.connection.state,
                        Connection::Idle | Connection::Backoff { .. } | Connection::GaveUp { .. }
                    )
                {
                    self.connection.start(now, false, &mut out.io);
                }
            }
            RouterInput::Tick => {
                let was_live = self.connection.opened();
                self.connection.tick(now, &mut out.io);
                if was_live && !self.connection.opened() {
                    self.disconnect_routes(out);
                }
                let due: Vec<_> = self
                    .routes
                    .iter()
                    .filter(|(_, r)| {
                        matches!(r.state, RouteState::Dropped { at } if at <= now.mono)
                            || r.deadline.is_some_and(|at| at <= now.mono)
                    })
                    .map(|(d, _)| d.clone())
                    .collect();
                for doc in due {
                    if self
                        .routes
                        .get(&doc)
                        .is_some_and(|r| r.deadline.is_some_and(|at| at <= now.mono))
                    {
                        self.drop_route(&doc, 4401, out);
                    } else if self.connection.synced() {
                        self.subscribe(&doc, out);
                    }
                }
            }
            _ => {}
        }
        self.set_wake(out);
    }

    fn clear_output(&self, out: &mut RouterOutput) {
        out.io.clear();
        out.to_sessions.clear();
        out.wake_at = None;
    }
    fn set_wake(&self, out: &mut RouterOutput) {
        out.wake_at = self
            .connection
            .wake_at()
            .into_iter()
            .chain(self.routes.values().filter_map(|r| match r.state {
                RouteState::Dropped { at } if self.connection.synced() => Some(at),
                _ => r.deadline,
            }))
            .min();
    }
    fn send(&self, message: sync_protocol::ToRouter<'_>, out: &mut RouterOutput) {
        let Some(conn) = self.connection.conn().filter(|_| self.connection.opened()) else {
            return;
        };
        let mut frame = Vec::new();
        if message.serialize(&mut frame).is_ok() {
            out.io.push(IoEffect::SocketSend { conn, frame });
        }
    }
    fn subscribe(&mut self, doc: &SyncDocId, out: &mut RouterOutput) {
        if !self.connection.synced() {
            return;
        }
        let Some(route) = self.routes.get_mut(doc) else {
            return;
        };
        route.reassembler = sync_protocol::framing::Reassembler::default();
        route.deadline = Some(self.now.mono.after(self.subscribe_timeout));
        if let Some(token) = route.initial_token.take() {
            route.state = RouteState::Subscribing;
            self.send(
                sync_protocol::ToRouter::RouterSubscribe {
                    doc_id: doc.as_str(),
                    token: token.expose_secret(),
                },
                out,
            );
        } else {
            self.next_attempt = self.next_attempt.saturating_add(1);
            route.state = RouteState::Authorizing(self.next_attempt);
            out.io.push(IoEffect::FetchToken {
                attempt: self.next_attempt,
                doc: doc.clone(),
            });
        }
    }
    fn token(&mut self, doc: SyncDocId, event: TokenEvent, out: &mut RouterOutput) {
        let Some(route) = self.routes.get_mut(&doc) else {
            return;
        };
        let RouteState::Authorizing(attempt) = route.state else {
            return;
        };
        match event {
            TokenEvent::Fetched {
                attempt: received,
                token,
                access,
            } if received == attempt => {
                route.access = access;
                route.state = RouteState::Subscribing;
                self.send(
                    sync_protocol::ToRouter::RouterSubscribe {
                        doc_id: doc.as_str(),
                        token: token.expose_secret(),
                    },
                    out,
                );
            }
            TokenEvent::Failed { attempt: received } if received == attempt => {
                self.drop_route(&doc, 4401, out)
            }
            _ => {}
        }
    }
    fn incoming(&mut self, bytes: &[u8], out: &mut RouterOutput) {
        let message = match sync_protocol::FromRouter::deserialize(bytes) {
            Ok(m) => m,
            Err(_) => {
                self.connection
                    .fail(self.now, CloseCause::ProtocolError, &mut out.io);
                self.disconnect_routes(out);
                return;
            }
        };
        match message {
            sync_protocol::FromRouter::RouterSubscribed { doc_id } => {
                let Ok(doc) = doc_id.parse::<SyncDocId>() else {
                    return;
                };
                let Some(route) = self.routes.get_mut(&doc) else {
                    return;
                };
                if !matches!(route.state, RouteState::Subscribing | RouteState::Open) {
                    return;
                }
                if matches!(route.state, RouteState::Open) {
                    out.to_sessions.push((
                        doc.clone(),
                        RouteEvent::Closed {
                            conn: route.generation,
                            code: 4000,
                        },
                    ));
                }
                self.next_route = self.next_route.saturating_add(1);
                route.generation = ConnId(self.next_route);
                route.state = RouteState::Open;
                route.deadline = None;
                route.delay = Millis(500);
                route.reassembler = sync_protocol::framing::Reassembler::default();
                out.to_sessions.push((
                    doc.clone(),
                    RouteEvent::Subscribed {
                        conn: route.generation,
                        access: route.access,
                    },
                ));
                let pending = std::mem::take(&mut route.pending);
                for frame in pending {
                    self.send(
                        sync_protocol::ToRouter::RouterFrame {
                            doc_id: doc.as_str(),
                            payload: SliceWrapper::from_cooked(&frame),
                        },
                        out,
                    );
                }
            }
            sync_protocol::FromRouter::RouterDocFrame { doc_id, payload } => {
                let Ok(doc) = doc_id.parse::<SyncDocId>() else {
                    return;
                };
                let Some(route) = self
                    .routes
                    .get_mut(&doc)
                    .filter(|r| matches!(r.state, RouteState::Open))
                else {
                    return;
                };
                match route.reassembler.push(&payload.iter().collect::<Vec<_>>()) {
                    Ok(Some(bytes)) => {
                        for frame in sync_protocol::framing::into_frames(
                            &bytes,
                            sync_protocol::framing::MAX_CHUNK_SIZE,
                        ) {
                            out.to_sessions.push((
                                doc.clone(),
                                RouteEvent::Frame {
                                    conn: route.generation,
                                    frame,
                                },
                            ));
                        }
                    }
                    Ok(None) => {}
                    Err(_) => self.drop_route(&doc, 4000, out),
                }
            }
            sync_protocol::FromRouter::RouterSubscribeFailed { doc_id, .. } => {
                if let Ok(doc) = doc_id.parse() {
                    self.drop_route(&doc, 4401, out);
                }
            }
            sync_protocol::FromRouter::RouterDocClosed { doc_id, .. } => {
                if let Ok(doc) = doc_id.parse() {
                    self.drop_route(&doc, 4000, out);
                }
            }
            sync_protocol::FromRouter::Unknown => {}
        }
    }
    fn drop_route(&mut self, doc: &SyncDocId, code: u16, out: &mut RouterOutput) {
        if let Some(route) = self.routes.get_mut(doc) {
            out.to_sessions.push((
                doc.clone(),
                RouteEvent::Closed {
                    conn: route.generation,
                    code,
                },
            ));
            route.pending.clear();
            route.reassembler = sync_protocol::framing::Reassembler::default();
            route.deadline = None;
            route.state = RouteState::Dropped {
                at: self.now.mono.after(route.delay),
            };
            route.delay = Millis(route.delay.0.saturating_mul(2).min(8_000));
        }
    }
    fn disconnect_routes(&mut self, out: &mut RouterOutput) {
        let docs: Vec<_> = self.routes.keys().cloned().collect();
        for doc in docs {
            self.drop_route(&doc, 4000, out);
            if let Some(route) = self.routes.get_mut(&doc) {
                route.state = RouteState::Closed;
            }
        }
    }
}

#[cfg(test)]
mod test;
