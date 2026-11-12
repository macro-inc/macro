//! The web client's real-time websocket (`wss-primary.slack.com`): connect,
//! `hello`, pings, `reconnect_url`, `goodbye`, and reconnects with backoff.

mod events;

use std::time::Duration;

use futures::{SinkExt, StreamExt};
use rand::Rng;
use serde::Deserialize;
use tokio::sync::mpsc;
use tokio::time::Instant;
use tokio_tungstenite::tungstenite::{self, Message as Frame, client::IntoClientRequest};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;
use tracing::field::Empty;
use url::Url;

pub use events::{
    ChannelEvent, ChannelIdChangedEvent, ChannelSharedEvent, ChannelUnsharedEvent,
    EmojiChangedEvent, Event, FileEvent, ImChannel, ImEvent, JoinedEvent, MarkedEvent,
    MemberChannelEvent, MessageEvent, ReactionEvent, ReactionItem, RenameEvent, RenamedChannel,
    SharedChannelInviteEvent, SlackEvent, ThreadMarkedEvent, ThreadSubscription, TypingEvent,
    UserEvent,
};

use crate::client::SlackClient;
use crate::credentials::Secret;
use crate::error::SlackErrorCode;

/// Events buffered before the socket waits for the consumer.
const EVENT_BUFFER: usize = 256;
/// A connection that lived this long resets the backoff.
const STABLE_CONNECTION: Duration = Duration::from_secs(60);

/// Timing of the real-time connection.
#[derive(Clone, Debug)]
pub struct RealtimeConfig {
    /// How often to ping.
    pub ping_interval: Duration,
    /// The connection is dead when nothing arrived for this long.
    pub silence_timeout: Duration,
    /// The first reconnect delay; doubles per failed attempt.
    pub initial_backoff: Duration,
    /// The reconnect delay ceiling.
    pub max_backoff: Duration,
}

impl Default for RealtimeConfig {
    fn default() -> Self {
        Self {
            ping_interval: Duration::from_secs(30),
            silence_timeout: Duration::from_secs(90),
            initial_backoff: Duration::from_secs(2),
            max_backoff: Duration::from_secs(300),
        }
    }
}

/// What the real-time connection reports.
#[derive(Clone, Debug, PartialEq)]
pub enum RealtimeEvent {
    /// Dialing; `attempt` counts reconnects since the last stable connection.
    Connecting {
        /// Reconnects so far.
        attempt: u32,
    },
    /// Slack said `hello`. Events may have been missed while disconnected
    /// unless `resumed`; catch up with `client.counts` and history.
    Connected {
        /// Reconnected through Slack's `reconnect_url`.
        resumed: bool,
    },
    /// The connection dropped; a reconnect follows.
    Disconnected {
        /// Why.
        reason: DisconnectReason,
    },
    /// The session is gone for good (signed out, revoked, deactivated). The
    /// connection stops; sign in again.
    SessionEnded {
        /// Slack's reason.
        code: SlackErrorCode,
    },
    /// A Slack event.
    Event(Event),
}

/// Why a connection dropped.
#[derive(Clone, Debug, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum DisconnectReason {
    /// Slack sent `goodbye` (server restart or migration).
    Goodbye,
    /// Nothing arrived within `silence_timeout`.
    SilenceTimeout,
    /// The socket closed.
    Closed,
    /// The handshake or socket failed.
    Failed(String),
}

#[derive(Deserialize)]
struct ControlFrame {
    #[serde(rename = "type")]
    frame_type: Option<String>,
    url: Option<String>,
    error: Option<SocketError>,
}

#[derive(Deserialize)]
struct SocketError {
    code: Option<i64>,
}

/// Slack's socket error code meaning the reconnect URL is no longer valid.
const RECONNECT_URL_INVALID: i64 = 1;

enum SessionOutcome {
    Disconnected(DisconnectReason),
    Cancelled,
}

impl SlackClient {
    /// Connects the real-time websocket on a task tracked by `tracker`, and
    /// keeps it connected until `cancel` fires, the receiver is dropped, or
    /// the session ends.
    pub fn connect_realtime(
        &self,
        config: RealtimeConfig,
        cancel: CancellationToken,
        tracker: &TaskTracker,
    ) -> mpsc::Receiver<RealtimeEvent> {
        let (sender, receiver) = mpsc::channel(EVENT_BUFFER);
        let client = self.clone();
        tracker.spawn(async move { client.run_realtime(config, cancel, sender).await });
        receiver
    }

    async fn run_realtime(
        self,
        config: RealtimeConfig,
        cancel: CancellationToken,
        sender: mpsc::Sender<RealtimeEvent>,
    ) {
        let mut reconnect_url: Option<Secret> = None;
        let mut attempt: u32 = 0;
        loop {
            if sender.send(RealtimeEvent::Connecting { attempt }).await.is_err() {
                return;
            }
            let resumed = reconnect_url.is_some();
            let dialed = tokio::select! {
                () = cancel.cancelled() => return,
                dialed = self.dial(reconnect_url.as_ref(), attempt) => dialed,
            };

            let mut retry_after = None;
            let reason = match dialed {
                Ok(socket) => {
                    let started = Instant::now();
                    let session = self.run_session(socket, &config, &cancel, &sender, &mut reconnect_url, resumed);
                    match session.await {
                        SessionOutcome::Cancelled => return,
                        SessionOutcome::Disconnected(reason) => {
                            if started.elapsed() >= STABLE_CONNECTION {
                                attempt = 0;
                            }
                            reason
                        }
                    }
                }
                Err(DialError::Rejected(status)) => {
                    // A rejected handshake says nothing about why; auth.test does.
                    reconnect_url = None;
                    match self.auth_test().await {
                        Err(error) if error.is_session_ended() => {
                            if let Some(code) = error.code() {
                                let _ = sender.send(RealtimeEvent::SessionEnded { code: code.clone() }).await;
                            }
                            return;
                        }
                        Err(error) => retry_after = error.retry_after(),
                        Ok(_) => {}
                    }
                    DisconnectReason::Failed(format!("handshake rejected with HTTP {status}"))
                }
                Err(DialError::Failed(error)) => {
                    reconnect_url = None;
                    DisconnectReason::Failed(error)
                }
            };

            let delay = match reason {
                DisconnectReason::Goodbye if attempt == 0 => Duration::ZERO,
                _ => backoff(&config, attempt).max(retry_after.unwrap_or_default()),
            };
            attempt = attempt.saturating_add(1);
            if sender.send(RealtimeEvent::Disconnected { reason }).await.is_err() {
                return;
            }
            tokio::select! {
                () = cancel.cancelled() => return,
                () = tokio::time::sleep(delay) => {}
            }
        }
    }

    /// The URL to dial: Slack's `reconnect_url`, or the socket host with the
    /// session token. Either one is a credential; never log it.
    fn socket_url(&self, reconnect_url: Option<&Secret>) -> Result<Secret, String> {
        if let Some(url) = reconnect_url {
            return Ok(url.clone());
        }
        let mut url: Url = self.endpoints().websocket.clone();
        url.query_pairs_mut()
            .append_pair("token", self.credentials().token.expose());
        Ok(Secret::new(url.into()))
    }

    async fn dial(&self, reconnect_url: Option<&Secret>, attempt: u32) -> Result<Socket, DialError> {
        let span = tracing::info_span!(
            "slack.websocket.connect",
            slack.team_id = %self.workspace().team_id,
            slack.attempt = attempt,
            slack.resumed = reconnect_url.is_some(),
            http.response.status_code = Empty,
            error.type = Empty,
            otel.status_code = Empty,
        );
        async {
            let url = self.socket_url(reconnect_url).map_err(DialError::Failed)?;
            let mut request = url
                .expose()
                .into_client_request()
                .map_err(|_| DialError::Failed("invalid websocket URL".to_owned()))?;
            let headers = request.headers_mut();
            headers.extend(self.cookie_headers());
            if let Ok(agent) = self.endpoints().user_agent.parse() {
                headers.insert(tungstenite::http::header::USER_AGENT, agent);
            }
            let outcome = tokio_tungstenite::connect_async(request).await;
            let span = tracing::Span::current();
            match outcome {
                Ok((socket, response)) => {
                    span.record("http.response.status_code", response.status().as_u16());
                    Ok(socket)
                }
                Err(tungstenite::Error::Http(response)) => {
                    let status = response.status().as_u16();
                    span.record("http.response.status_code", status);
                    span.record("error.type", "handshake_rejected");
                    span.record("otel.status_code", "ERROR");
                    Err(DialError::Rejected(status))
                }
                Err(error) => {
                    span.record("error.type", "transport");
                    span.record("otel.status_code", "ERROR");
                    Err(DialError::Failed(error.to_string()))
                }
            }
        }
        .instrument(span)
        .await
    }

    async fn run_session(
        &self,
        mut socket: Socket,
        config: &RealtimeConfig,
        cancel: &CancellationToken,
        sender: &mpsc::Sender<RealtimeEvent>,
        reconnect_url: &mut Option<Secret>,
        resumed: bool,
    ) -> SessionOutcome {
        let span = tracing::info_span!(
            "slack.websocket.session",
            slack.team_id = %self.workspace().team_id,
            slack.resumed = resumed,
            slack.events = Empty,
            slack.close_reason = Empty,
        );
        let session = async {
            let mut ping = tokio::time::interval_at(Instant::now() + config.ping_interval, config.ping_interval);
            let mut last_received = Instant::now();
            let mut ping_id: u64 = 0;
            let mut events: u64 = 0;
            let outcome = loop {
                tokio::select! {
                    () = cancel.cancelled() => {
                        let _ = socket.close(None).await;
                        break SessionOutcome::Cancelled;
                    }
                    _ = ping.tick() => {
                        if last_received.elapsed() >= config.silence_timeout {
                            break SessionOutcome::Disconnected(DisconnectReason::SilenceTimeout);
                        }
                        ping_id += 1;
                        let ping = serde_json::json!({
                            "id": ping_id,
                            "type": "ping",
                            "ts": chrono::Utc::now().timestamp(),
                        });
                        if let Err(error) = socket.send(Frame::text(ping.to_string())).await {
                            break SessionOutcome::Disconnected(DisconnectReason::Failed(error.to_string()));
                        }
                    }
                    frame = socket.next() => {
                        last_received = Instant::now();
                        let text = match frame {
                            None | Some(Ok(Frame::Close(_))) => {
                                break SessionOutcome::Disconnected(DisconnectReason::Closed);
                            }
                            Some(Err(error)) => {
                                break SessionOutcome::Disconnected(DisconnectReason::Failed(error.to_string()));
                            }
                            Some(Ok(Frame::Text(text))) => text,
                            Some(Ok(_)) => continue,
                        };
                        let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) else {
                            tracing::warn!("slack websocket sent a frame that isn't JSON");
                            continue;
                        };
                        let control = serde_json::from_value::<ControlFrame>(raw.clone()).ok();
                        let frame_type = control.as_ref().and_then(|control| control.frame_type.as_deref());
                        let forwarded = match frame_type {
                            Some("hello") => RealtimeEvent::Connected { resumed },
                            Some("pong") => continue,
                            Some("goodbye") => {
                                break SessionOutcome::Disconnected(DisconnectReason::Goodbye);
                            }
                            Some("reconnect_url") => {
                                *reconnect_url = control
                                    .and_then(|control| control.url)
                                    .map(Secret::new);
                                continue;
                            }
                            Some("error") => {
                                let code = control.and_then(|control| control.error).and_then(|error| error.code);
                                if code == Some(RECONNECT_URL_INVALID) {
                                    *reconnect_url = None;
                                }
                                tracing::warn!(slack.socket_error_code = code, "slack websocket reported an error");
                                continue;
                            }
                            _ => {
                                events += 1;
                                RealtimeEvent::Event(Event::parse(raw))
                            }
                        };
                        if sender.send(forwarded).await.is_err() {
                            let _ = socket.close(None).await;
                            break SessionOutcome::Cancelled;
                        }
                    }
                }
            };
            let span = tracing::Span::current();
            span.record("slack.events", events);
            match &outcome {
                SessionOutcome::Cancelled => span.record("slack.close_reason", "cancelled"),
                SessionOutcome::Disconnected(reason) => {
                    span.record("slack.close_reason", <&'static str>::from(reason))
                }
            };
            outcome
        };
        session.instrument(span).await
    }
}

type Socket = tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

enum DialError {
    Rejected(u16),
    Failed(String),
}

/// Exponential backoff with jitter: half to all of
/// `min(initial * 2^attempt, max)`.
fn backoff(config: &RealtimeConfig, attempt: u32) -> Duration {
    let ceiling = config
        .initial_backoff
        .saturating_mul(2u32.saturating_pow(attempt.min(16)))
        .min(config.max_backoff);
    let half = ceiling / 2;
    let jitter_millis = u64::try_from(half.as_millis()).unwrap_or(u64::MAX);
    half + Duration::from_millis(rand::rng().random_range(0..=jitter_millis))
}

