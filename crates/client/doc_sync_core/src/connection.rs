//! Shared deterministic physical-connection and heartbeat transitions.

use crate::*;

/// A physical connection's lifecycle. Generations isolate late host callbacks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Connection {
    /// No connection has been requested.
    Idle,
    /// Fetching a token for the next physical connection.
    Authorizing {
        /// Reserved connection generation.
        conn: ConnId,
        /// Token request correlation.
        attempt: u32,
    },
    /// Waiting for the host to open the socket.
    Connecting {
        /// Current generation.
        conn: ConnId,
        /// Current retry attempt.
        attempt: u32,
        /// Connect deadline.
        deadline: Millis,
    },
    /// Socket open, waiting for the initial document handshake.
    AwaitingInitialSync {
        /// Current generation.
        conn: ConnId,
        /// Time at which heartbeat starts even without a handshake.
        deadline: Millis,
        /// Heartbeat after the initial waiter times out.
        heartbeat: Option<Heartbeat>,
    },
    /// Initial handshake has completed.
    Synced {
        /// Current generation.
        conn: ConnId,
        /// Current heartbeat state.
        heartbeat: Heartbeat,
    },
    /// Waiting for a scheduled retry.
    Backoff {
        /// One-based retry attempt.
        attempt: u32,
        /// Earliest reconnect time.
        retry_at: Millis,
    },
    /// Retry budget spent; host activity can revive the connection.
    GaveUp {
        /// Attempts made before giving up.
        attempts: u32,
    },
    /// Terminal; no later event revives this session.
    Closed(CloseReason),
}

/// Heartbeat state; cadence is anchored independently from pong receipt.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Heartbeat {
    /// Waiting for the next fixed cadence slot.
    Waiting {
        /// Next ping time.
        next_ping_at: Millis,
        /// Consecutive missed pongs.
        missed: u8,
    },
    /// A ping has been sent.
    AwaitingPong {
        /// Current pong deadline.
        deadline: Millis,
        /// Previously missed pongs.
        missed: u8,
    },
}

pub(crate) enum ConnectionTarget {
    Document(SyncDocId),
    Router,
}

pub(crate) struct ConnectionSettings {
    pub target: ConnectionTarget,
    pub timeouts: Timeouts,
    pub heartbeat: HeartbeatPolicy,
    pub backoff: BackoffPolicy,
    pub initial_token: Option<SyncToken>,
    pub initial_access: WriteAccess,
    pub traceparent: Option<String>,
}

pub(crate) struct ConnectionMachine {
    pub state: Connection,
    pub access: WriteAccess,
    settings: ConnectionSettings,
    next_conn: u32,
    next_token: u32,
    retries: u32,
    last_token: Option<SyncToken>,
    allow_fallback: bool,
    next_ping: Option<Millis>,
    denied: Option<u16>,
}

impl ConnectionMachine {
    pub fn new(settings: ConnectionSettings) -> Self {
        Self {
            allow_fallback: settings.initial_token.is_some(),
            access: settings.initial_access,
            settings,
            state: Connection::Idle,
            next_conn: 0,
            next_token: 0,
            retries: 0,
            last_token: None,
            next_ping: None,
            denied: None,
        }
    }

    pub fn conn(&self) -> Option<ConnId> {
        match self.state {
            Connection::Authorizing { conn, .. }
            | Connection::Connecting { conn, .. }
            | Connection::AwaitingInitialSync { conn, .. }
            | Connection::Synced { conn, .. } => Some(conn),
            _ => None,
        }
    }

    pub fn synced(&self) -> bool {
        matches!(self.state, Connection::Synced { .. })
    }

    pub fn opened(&self) -> bool {
        matches!(
            self.state,
            Connection::AwaitingInitialSync { .. } | Connection::Synced { .. }
        )
    }

    pub fn start(&mut self, now: Now, force_token: bool, out: &mut Vec<IoEffect>) {
        if matches!(self.state, Connection::Closed(_)) {
            return;
        }
        let Some(next) = self.next_conn.checked_add(1) else {
            self.state = Connection::Closed(CloseReason::Corrupt);
            return;
        };
        self.next_conn = next;
        let conn = ConnId(next);
        self.next_ping = None;
        if matches!(self.settings.target, ConnectionTarget::Router) {
            self.state = Connection::Connecting {
                conn,
                attempt: self.retries,
                deadline: now.mono.after(self.settings.timeouts.connect),
            };
            out.push(IoEffect::RouterConnect {
                conn,
                traceparent: self.settings.traceparent.clone(),
            });
        } else if let Some(token) = self.settings.initial_token.take().filter(|_| !force_token) {
            self.connect(conn, token, now, out);
        } else {
            let Some(attempt) = self.next_token.checked_add(1) else {
                self.state = Connection::Closed(CloseReason::Corrupt);
                return;
            };
            self.next_token = attempt;
            self.state = Connection::Authorizing { conn, attempt };
            if let ConnectionTarget::Document(doc) = &self.settings.target {
                out.push(IoEffect::FetchToken {
                    attempt,
                    doc: doc.clone(),
                });
            }
        }
    }

    fn connect(&mut self, conn: ConnId, token: SyncToken, now: Now, out: &mut Vec<IoEffect>) {
        self.last_token = Some(token.clone());
        self.state = Connection::Connecting {
            conn,
            attempt: self.retries,
            deadline: now.mono.after(self.settings.timeouts.connect),
        };
        if let ConnectionTarget::Document(doc) = &self.settings.target {
            out.push(IoEffect::SocketConnect {
                conn,
                doc: doc.clone(),
                token,
                traceparent: self.settings.traceparent.clone(),
            });
        }
    }

    pub fn token(&mut self, event: TokenEvent, now: Now, out: &mut Vec<IoEffect>) {
        let Connection::Authorizing { conn, attempt } = self.state else {
            return;
        };
        match event {
            TokenEvent::Fetched {
                attempt: received,
                token,
                access,
            } if received == attempt => {
                self.access = access;
                self.connect(conn, token, now, out);
            }
            TokenEvent::Failed { attempt: received } if received == attempt => {
                if let Some(token) = self.last_token.clone().filter(|_| self.allow_fallback) {
                    self.connect(conn, token, now, out);
                } else {
                    self.retry(now);
                }
            }
            _ => {}
        }
    }

    /// Returns true only for a newly opened physical socket.
    pub fn socket(
        &mut self,
        conn: ConnId,
        event: &SocketEvent,
        now: Now,
        out: &mut Vec<IoEffect>,
    ) -> bool {
        if self.conn() != Some(conn) {
            return false;
        }
        match event {
            SocketEvent::Opened if matches!(self.state, Connection::Connecting { .. }) => {
                self.retries = 0;
                self.next_ping = None;
                if matches!(self.settings.target, ConnectionTarget::Router) {
                    self.establish(conn, now);
                } else {
                    self.state = Connection::AwaitingInitialSync {
                        conn,
                        deadline: now.mono.after(self.settings.timeouts.initial_sync),
                        heartbeat: None,
                    };
                }
                true
            }
            SocketEvent::Closed { code, .. } => {
                if matches!(*code, 1008 | 4401) {
                    if self.denied == Some(*code) {
                        self.state = Connection::Closed(CloseReason::Unauthorized);
                    } else {
                        self.denied = Some(*code);
                        self.allow_fallback = false;
                        // Both codes get one newly authorized connection before termination.
                        self.start(now, true, out);
                    }
                } else {
                    self.denied = None;
                    self.retry(now);
                }
                false
            }
            SocketEvent::Text(text) if text == sync_protocol::PONG && self.opened() => {
                if let Some(next_ping_at) = self.next_ping {
                    let heartbeat = Heartbeat::Waiting {
                        next_ping_at,
                        missed: 0,
                    };
                    match &mut self.state {
                        Connection::Synced { heartbeat: h, .. } => *h = heartbeat,
                        Connection::AwaitingInitialSync { heartbeat: h, .. } => {
                            *h = Some(heartbeat)
                        }
                        _ => {}
                    }
                }
                false
            }
            _ => false,
        }
    }

    pub fn establish(&mut self, conn: ConnId, now: Now) {
        let next_ping_at = now.mono.after(self.settings.heartbeat.interval);
        self.next_ping = Some(next_ping_at);
        self.state = Connection::Synced {
            conn,
            heartbeat: Heartbeat::Waiting {
                next_ping_at,
                missed: 0,
            },
        };
    }

    pub fn initial(&mut self, now: Now) -> bool {
        if let Some(conn) = self.conn().filter(|_| self.opened()) {
            self.establish(conn, now);
            true
        } else {
            false
        }
    }

    pub fn retry(&mut self, now: Now) {
        self.next_ping = None;
        self.retries = self.retries.saturating_add(1);
        if self.retries > self.settings.backoff.max_retries {
            self.state = Connection::GaveUp {
                attempts: self.retries,
            };
        } else {
            let factor = 1u64
                .checked_shl(
                    self.retries
                        .min(u32::from(self.settings.backoff.max_exponent)),
                )
                .unwrap_or(u64::MAX);
            let delay = Millis(self.settings.backoff.base.0.saturating_mul(factor));
            self.state = Connection::Backoff {
                attempt: self.retries,
                retry_at: now.mono.after(delay),
            };
        }
    }

    pub fn fail(&mut self, now: Now, cause: CloseCause, out: &mut Vec<IoEffect>) {
        if let Some(conn) = self.conn() {
            out.push(IoEffect::SocketClose {
                conn,
                code: 1000,
                reason: cause,
            });
        }
        self.retry(now);
    }

    pub fn close(&mut self, reason: CloseReason, out: &mut Vec<IoEffect>) {
        if let Some(conn) = self.conn() {
            let cause = match reason {
                CloseReason::Stopped => CloseCause::Stopped,
                CloseReason::Unauthorized => CloseCause::Unauthorized,
                CloseReason::Corrupt => CloseCause::ProtocolError,
            };
            out.push(IoEffect::SocketClose {
                conn,
                code: 1000,
                reason: cause,
            });
        }
        self.state = Connection::Closed(reason);
        self.next_ping = None;
    }

    pub fn wake_at(&self) -> Option<Millis> {
        match &self.state {
            Connection::Connecting { deadline, .. } => Some(*deadline),
            Connection::AwaitingInitialSync {
                deadline,
                heartbeat,
                ..
            } => heartbeat
                .as_ref()
                .map(Self::heartbeat_deadline)
                .or(Some(*deadline)),
            Connection::Synced { heartbeat, .. } => Some(Self::heartbeat_deadline(heartbeat)),
            Connection::Backoff { retry_at, .. } => Some(*retry_at),
            _ => None,
        }
    }

    fn heartbeat_deadline(heartbeat: &Heartbeat) -> Millis {
        match heartbeat {
            Heartbeat::Waiting { next_ping_at, .. } => *next_ping_at,
            Heartbeat::AwaitingPong { deadline, .. } => *deadline,
        }
    }

    pub fn tick(&mut self, now: Now, out: &mut Vec<IoEffect>) {
        match &self.state {
            Connection::Backoff { retry_at, .. } if now.mono >= *retry_at => {
                self.start(now, false, out);
                return;
            }
            Connection::Connecting { deadline, .. } if now.mono >= *deadline => {
                self.fail(now, CloseCause::ConnectTimeout, out);
                return;
            }
            Connection::AwaitingInitialSync {
                conn,
                deadline,
                heartbeat: None,
            } if now.mono >= *deadline => {
                let conn = *conn;
                let next_ping_at = now.mono.after(self.settings.heartbeat.interval);
                self.next_ping = Some(next_ping_at);
                self.state = Connection::AwaitingInitialSync {
                    conn,
                    deadline: *deadline,
                    heartbeat: Some(Heartbeat::Waiting {
                        next_ping_at,
                        missed: 0,
                    }),
                };
            }
            _ => {}
        }
        let Some(conn) = self.conn() else {
            return;
        };
        let heartbeat = match &mut self.state {
            Connection::Synced { heartbeat, .. } => Some(heartbeat),
            Connection::AwaitingInitialSync { heartbeat, .. } => heartbeat.as_mut(),
            _ => None,
        };
        let Some(heartbeat) = heartbeat else {
            return;
        };
        match *heartbeat {
            Heartbeat::Waiting {
                next_ping_at,
                missed,
            } if now.mono >= next_ping_at => {
                let interval = self.settings.heartbeat.interval.0.max(1);
                let elapsed = now.mono.0.saturating_sub(next_ping_at.0) / interval + 1;
                self.next_ping = Some(Millis(
                    next_ping_at
                        .0
                        .saturating_add(elapsed.saturating_mul(interval)),
                ));
                *heartbeat = Heartbeat::AwaitingPong {
                    deadline: now.mono.after(self.settings.heartbeat.timeout),
                    missed,
                };
                out.push(IoEffect::SocketPing { conn });
            }
            Heartbeat::AwaitingPong { deadline, missed } if now.mono >= deadline => {
                let next_missed = missed.saturating_add(1);
                if next_missed > self.settings.heartbeat.max_missed {
                    self.fail(now, CloseCause::NoHeartbeat, out);
                } else if let Some(next_ping_at) = self.next_ping {
                    *heartbeat = Heartbeat::Waiting {
                        next_ping_at,
                        missed: next_missed,
                    };
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod test;
