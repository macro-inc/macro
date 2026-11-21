//! One viewer's screen socket: control messages, the media path, input and
//! the lease. Binary frames are media; text frames are the JSON control
//! messages below.

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::extract::ws::{Message, Utf8Bytes, WebSocket};
use computer_screen::domain::models::{
    Driver, EndReason, Lease, Mode, ScreenGrant, SessionId, Surface, TakeOver, Transport,
};
use computer_screen::domain::service::ScreenError;
use futures::{SinkExt as _, StreamExt as _};
use hosted_runtimes::domain::ids::ComputerId;
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::{Notify, broadcast, mpsc, watch};
use tokio_util::sync::CancellationToken;
use tracing::Instrument as _;
use tracing::field::Empty;

use super::Screens;
use super::media::{
    FromViewer, MediaContext, MediaEnd, MediaError, MediaRun, ScreenMedia, ToViewer,
};
use super::rfb::{InputEvent, RfbInjector};
use super::tunnel::{
    ComputerPower, GuestPort, GuestTunnel, ScreenWaker, TunnelError, TunnelExited, Woken,
};

#[cfg(test)]
mod test;

/// How often a viewer's access is checked again, and its socket marked as
/// still open.
pub const REAUTHORIZE_EVERY: Duration = computer_screen::domain::service::SESSION_TOUCH_EVERY;
/// How often driver input renews the lease at most.
const RENEW_EVERY: Duration = Duration::from_secs(15);
/// Frames buffered between media and a slow viewer.
const MEDIA_BUFFER: usize = 32;
/// How long a wake may take before the viewer is told the computer is
/// waking: an awake computer answers well within it.
const WAKING_NOTICE_AFTER: Duration = Duration::from_millis(300);
/// How long the injector's handshake with Xvnc, or one input, may take.
const INJECTOR_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// The longest hand-back note kept, in characters.
const MAX_NOTE_CHARS: usize = 2000;

/// A control message from the viewer.
#[derive(Debug, serde::Deserialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ClientMessage {
    TakeOver,
    HandBack {
        #[serde(default)]
        note: Option<String>,
    },
    Input {
        event: InputEvent,
    },
    Stop,
}

/// What a recoverable `error` message is about.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ErrorCode {
    /// A take-over on a view ticket.
    DriveNotAllowed,
    /// Someone else drives.
    DriverBusy,
    /// Input or hand-back without the lease.
    NotDriver,
    /// The computer runs, but its screen closed.
    SourceUnavailable,
    /// An unparseable control message.
    BadMessage,
    /// The guest didn't take the input.
    InputFailed,
    /// The computer runs, but its screen couldn't be reached.
    TunnelFailed,
    /// Too many screens are open on the computer, or by this person on it.
    TooManySockets,
}

/// A control message to the viewer.
#[derive(Debug, serde::Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
enum ServerMessage<'a> {
    State {
        driver: Option<&'a Driver>,
        /// Whether this socket holds the lease: false while the same user
        /// drives from another tab.
        driving_here: bool,
        agent_held: bool,
        surface: Surface,
        transport: Transport,
        viewers: u32,
        /// The computer was hibernated and is waking; no frames yet.
        waking: bool,
    },
    Error {
        code: ErrorCode,
        message: &'a str,
    },
    Ended {
        reason: EndReason,
    },
}

/// How many sockets watch each computer in this process.
pub struct Viewers {
    counts: Mutex<HashMap<ComputerId, u32>>,
    changed: broadcast::Sender<ComputerId>,
}

impl Default for Viewers {
    fn default() -> Self {
        Self {
            counts: Mutex::default(),
            changed: broadcast::channel(64).0,
        }
    }
}

impl Viewers {
    fn join(self: &Arc<Self>, computer: ComputerId) -> ViewerGuard {
        if let Ok(mut counts) = self.counts.lock() {
            *counts.entry(computer).or_default() += 1;
        }
        let _ = self.changed.send(computer);
        ViewerGuard {
            viewers: Arc::clone(self),
            computer,
        }
    }

    fn count(&self, computer: ComputerId) -> u32 {
        self.counts
            .lock()
            .ok()
            .and_then(|counts| counts.get(&computer).copied())
            .unwrap_or(0)
    }
}

struct ViewerGuard {
    viewers: Arc<Viewers>,
    computer: ComputerId,
}

impl Drop for ViewerGuard {
    fn drop(&mut self) {
        if let Ok(mut counts) = self.viewers.counts.lock()
            && let Some(count) = counts.get_mut(&self.computer)
        {
            *count = count.saturating_sub(1);
            if *count == 0 {
                counts.remove(&self.computer);
            }
        }
        let _ = self.viewers.changed.send(self.computer);
    }
}

/// Checks the viewer still may watch (or drive) as their ticket allowed.
/// `None` when the lookup failed.
pub type Reauthorize =
    Arc<dyn Fn() -> Pin<Box<dyn Future<Output = Option<bool>> + Send>> + Send + Sync>;

/// Access checks in a row that may fail to look anything up before the
/// socket ends: a passing outage doesn't drop viewers, a lasting one
/// doesn't leave them unchecked.
const MAX_FAILED_ACCESS_CHECKS: u8 = 3;

/// What a socket runs with.
pub struct SocketDeps {
    pub screens: Arc<Screens>,
    pub tunnel: Arc<dyn GuestTunnel>,
    pub waker: Arc<dyn ScreenWaker>,
    pub media: Arc<dyn ScreenMedia>,
    pub viewers: Arc<Viewers>,
    pub reauthorize: Reauthorize,
    /// How often access is checked again and the socket marked seen:
    /// [`REAUTHORIZE_EVERY`] outside tests.
    pub reauthorize_every: Duration,
    pub shutdown: CancellationToken,
}

/// The running media path and its channels.
struct MediaSlot {
    run: MediaRun,
    to_viewer: mpsc::Receiver<ToViewer>,
    from_viewer: mpsc::Sender<FromViewer>,
}

/// Why the loop stopped, and what to tell the viewer first.
#[derive(Debug)]
struct Ending {
    reason: EndReason,
    error: Option<(ErrorCode, String)>,
}

impl Ending {
    fn plain(reason: EndReason) -> Self {
        Self {
            reason,
            error: None,
        }
    }
}

/// Serve one viewer until it stops, the computer goes, access ends or the
/// process shuts down. The lease outlives the socket by its grace.
pub async fn serve(
    socket: WebSocket,
    grant: ScreenGrant,
    deps: SocketDeps,
    traceparent: Option<String>,
) {
    let span = tracing::info_span!(
        "computer.screen.session",
        computer.id = %grant.computer_id,
        harness.id = %grant.harness_id,
        screen.session.id = Empty,
        screen.transport = %grant.transport,
        screen.surface = %grant.surface,
        screen.mode = %grant.mode,
        screen.end_reason = Empty,
        screen.bytes_to_viewer = Empty,
        screen.bytes_from_viewer = Empty,
        otel.status_code = Empty,
    );
    // The socket continues the ticket request's trace.
    hosted_runtimes::domain::telemetry::attach(&span, traceparent.as_deref());
    tracing::Instrument::instrument(serve_in_span(socket, grant, deps, span.clone()), span).await;
}

async fn serve_in_span(
    socket: WebSocket,
    grant: ScreenGrant,
    deps: SocketDeps,
    span: tracing::Span,
) {
    let session = match deps.screens.open_session(&grant).await {
        Ok(session) => session,
        Err(ScreenError::TooManySockets) => {
            span.record("screen.end_reason", EndReason::Error.as_ref());
            let (sink, _) = socket.split();
            let (outbox, writer) = Outbox::start(sink);
            let _ = send(
                &outbox,
                &ServerMessage::Error {
                    code: ErrorCode::TooManySockets,
                    message: "too many screens are open on this computer",
                },
            )
            .await;
            let _ = send(
                &outbox,
                &ServerMessage::Ended {
                    reason: EndReason::Error,
                },
            )
            .await;
            drop(outbox);
            let _ = writer.await;
            return;
        }
        Err(error) => {
            tracing::error!(error = ?error, "could not open the screen audit row");
            span.record("otel.status_code", "ERROR");
            return;
        }
    };
    span.record("screen.session.id", tracing::field::display(session));

    let mut connection = Connection {
        grant,
        session,
        deps,
        bytes_to_viewer: 0,
        bytes_from_viewer: 0,
        waking: false,
    };
    let (sink, receiver) = socket.split();
    let (outbox, writer) = Outbox::start(sink);
    let ending = connection.run(&outbox, receiver).await;

    if let Some((code, message)) = &ending.error {
        let _ = send(
            &outbox,
            &ServerMessage::Error {
                code: *code,
                message,
            },
        )
        .await;
    }
    let _ = send(
        &outbox,
        &ServerMessage::Ended {
            reason: ending.reason,
        },
    )
    .await;
    // The writer flushes and closes, or gives up after its timeout.
    drop(outbox);

    span.record("screen.end_reason", ending.reason.as_ref());
    span.record("screen.bytes_to_viewer", connection.bytes_to_viewer);
    span.record("screen.bytes_from_viewer", connection.bytes_from_viewer);
    if ending.reason == EndReason::Error {
        span.record("otel.status_code", "ERROR");
    }
    connection
        .deps
        .screens
        .close_session(
            session,
            ending.reason,
            connection.bytes_to_viewer,
            connection.bytes_from_viewer,
        )
        .await
        .inspect_err(
            |error| tracing::error!(error = ?error, "could not close the screen audit row"),
        )
        .ok();
    let _ = writer.await;
}

type Sink = futures::stream::SplitSink<WebSocket, Message>;
type Receiver = futures::stream::SplitStream<WebSocket>;

/// Messages waiting for a viewer.
const OUTBOX_MESSAGES: usize = 64;
/// Room in the outbox kept for control messages: media waits once only
/// this much is left.
const CONTROL_HEADROOM: usize = 8;
/// How long one message may take to reach a viewer before the viewer counts
/// as gone: a link this slow can't show a screen anyway.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

/// The viewer couldn't take another message: its outbox is full or its
/// writer gave up.
#[derive(Debug)]
struct Stalled;

/// The way to a viewer. Its own task writes the WebSocket, so a viewer that
/// stops reading never stalls the socket's loop (shutdown, access checks,
/// lease changes keep running): the outbox fills, media waits, and a write
/// that takes longer than [`SEND_TIMEOUT`] ends the socket.
struct Outbox {
    queue: mpsc::Sender<Message>,
    stalled: CancellationToken,
}

impl Outbox {
    /// Write to `sink` from a task of its own, until the outbox is dropped.
    fn start(mut sink: Sink) -> (Self, tokio::task::JoinHandle<()>) {
        let (queue, mut pending) = mpsc::channel(OUTBOX_MESSAGES);
        let stalled = CancellationToken::new();
        let writer_stalled = stalled.clone();
        let writer = tokio::spawn(
            async move {
                while let Some(message) = pending.recv().await {
                    match tokio::time::timeout(SEND_TIMEOUT, sink.send(message)).await {
                        Ok(Ok(())) => {}
                        Ok(Err(_)) => {
                            writer_stalled.cancel();
                            return;
                        }
                        Err(_) => {
                            tracing::info!("a screen viewer stopped reading");
                            writer_stalled.cancel();
                            return;
                        }
                    }
                }
                let _ = tokio::time::timeout(SEND_TIMEOUT, sink.close()).await;
            }
            .in_current_span(),
        );
        (Self { queue, stalled }, writer)
    }

    /// Queue `message`; an outbox that is full means the viewer is gone.
    fn push(&self, message: Message) -> Result<(), Stalled> {
        self.queue.try_send(message).map_err(|_| Stalled)
    }

    /// Whether media may queue another frame.
    fn has_room_for_media(&self) -> bool {
        self.queue.capacity() > CONTROL_HEADROOM
    }
}

async fn send(sender: &Outbox, message: &ServerMessage<'_>) -> Result<(), Stalled> {
    let text = serde_json::to_string(message).unwrap_or_default();
    sender.push(Message::Text(Utf8Bytes::from(text)))
}

struct Connection {
    grant: ScreenGrant,
    session: SessionId,
    deps: SocketDeps,
    bytes_to_viewer: u64,
    bytes_from_viewer: u64,
    /// Whether the computer is being woken; said in every `state`.
    waking: bool,
}

impl Connection {
    fn start_media(&self, driving: &watch::Receiver<bool>, activity: &Arc<Notify>) -> MediaSlot {
        let (to_viewer_sender, to_viewer) = mpsc::channel(MEDIA_BUFFER);
        let (from_viewer, from_viewer_receiver) = mpsc::channel(MEDIA_BUFFER);
        let run = self.deps.media.run(MediaContext {
            computer_id: self.grant.computer_id,
            tunnel: Arc::clone(&self.deps.tunnel),
            to_viewer: to_viewer_sender,
            from_viewer: from_viewer_receiver,
            driving: driving.clone(),
            activity: Arc::clone(activity),
        });
        MediaSlot {
            run,
            to_viewer,
            from_viewer,
        }
    }

    async fn state(
        &self,
        sender: &Outbox,
        lease: Option<&Lease>,
        surface: Surface,
    ) -> Result<(), Stalled> {
        send(
            sender,
            &ServerMessage::State {
                driver: lease.map(|lease| &lease.driver),
                driving_here: drives_here(lease, self.session),
                agent_held: lease.is_some_and(|lease| lease.agent_user_id.is_some()),
                surface,
                transport: self.grant.transport,
                viewers: self.deps.viewers.count(self.grant.computer_id),
                waking: self.waking,
            },
        )
        .await
    }

    /// Wake a hibernated computer before its first frame, telling the viewer
    /// when that takes a moment. A computer still waking after the wait is
    /// tried anyway: its display may be up before its runtime is.
    async fn wake(
        &mut self,
        sender: &Outbox,
        lease: Option<&Lease>,
        surface: Surface,
    ) -> Result<Result<Woken, TunnelError>, Stalled> {
        let waker = Arc::clone(&self.deps.waker);
        let harness = self.grant.harness_id;
        let span = tracing::info_span!(
            "computer.screen.wake",
            harness.id = %harness,
            screen.woken = Empty,
            screen.waited = Empty,
        );
        let mut noticed = false;
        let woken = noticed_after(waker.wake(harness), WAKING_NOTICE_AFTER, async {
            noticed = true;
            self.waking = true;
            let told = self.state(sender, lease, surface).await;
            self.waking = false;
            told
        })
        .instrument(span.clone())
        .await;
        let (woken, told) = woken;
        span.record("screen.waited", noticed);
        if let Ok(woken) = &woken {
            span.record("screen.woken", tracing::field::debug(woken));
        }
        told?;
        if noticed {
            self.state(sender, lease, surface).await?;
        }
        Ok(woken)
    }

    async fn error(sender: &Outbox, code: ErrorCode, message: &str) -> Result<(), Stalled> {
        send(sender, &ServerMessage::Error { code, message }).await
    }

    async fn run(&mut self, sender: &Outbox, mut receiver: Receiver) -> Ending {
        let computer = self.grant.computer_id;
        let _viewer = self.deps.viewers.join(computer);
        let mut lease_changes = self.deps.screens.changes();
        let mut viewer_changes = self.deps.viewers.changed.subscribe();

        let mut lease = match self.deps.screens.lease(computer).await {
            Ok(lease) => lease,
            Err(error) => return internal(&error),
        };
        let (driving_sender, driving) = watch::channel(false);
        let activity = Arc::new(Notify::new());
        let surface = self.grant.surface;
        let mut injector: Option<RfbInjector> = None;
        let mut last_renew = tokio::time::Instant::now();
        let mut failed_checks: u8 = 0;
        let mut reauthorize = tokio::time::interval_at(
            tokio::time::Instant::now() + self.deps.reauthorize_every,
            self.deps.reauthorize_every,
        );

        // The state, with its surface, goes out before the first frame.
        if self.state(sender, lease.as_ref(), surface).await.is_err() {
            return Ending::plain(EndReason::Stopped);
        }
        match self.wake(sender, lease.as_ref(), surface).await {
            Ok(Ok(_)) => {}
            Ok(Err(error)) => {
                tracing::warn!(error = %error, "could not wake the computer for its screen");
                return Ending::plain(EndReason::ComputerOff);
            }
            Err(_) => return Ending::plain(EndReason::Stopped),
        }
        let mut media = self.start_media(&driving, &activity);

        loop {
            let _ = driving_sender.send(
                lease
                    .as_ref()
                    .is_some_and(|lease| lease.session_id == self.session),
            );
            let lapse = lease.as_ref().map(|lease| {
                let left = (lease.expires_at - chrono::Utc::now())
                    .to_std()
                    .unwrap_or(Duration::ZERO);
                tokio::time::Instant::now() + left
            });
            let MediaSlot {
                run,
                to_viewer,
                from_viewer,
            } = &mut media;

            tokio::select! {
                () = self.deps.shutdown.cancelled() => return Ending::plain(EndReason::Shutdown),

                // The viewer stopped reading, or its connection broke.
                () = sender.stalled.cancelled() => return Ending::plain(EndReason::Stopped),

                ended = run => {
                    return match media_ending(ended) {
                        Ok(ending) => ending,
                        Err(stopped) => {
                            let power = self.deps.waker.power(computer).await;
                            stopped_short_ending(stopped, power)
                        }
                    };
                }

                out = to_viewer.recv(), if sender.has_room_for_media() => {
                    let message = match out {
                        Some(ToViewer::Binary(bytes)) => {
                            self.bytes_to_viewer += bytes.len() as u64;
                            Message::Binary(bytes)
                        }
                        None => continue,
                    };
                    if sender.push(message).is_err() {
                        return Ending::plain(EndReason::Stopped);
                    }
                }

                incoming = receiver.next() => {
                    let text = match incoming {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return Ending::plain(EndReason::Stopped),
                        Some(Ok(Message::Binary(bytes))) => {
                            self.bytes_from_viewer += bytes.len() as u64;
                            let _ = from_viewer.send(FromViewer::Binary(bytes)).await;
                            continue;
                        }
                        Some(Ok(Message::Text(text))) => text,
                        Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    };
                    self.bytes_from_viewer += text.len() as u64;
                    let Ok(message) = serde_json::from_str::<ClientMessage>(&text) else {
                        if Self::error(sender, ErrorCode::BadMessage, "unreadable control message").await.is_err() {
                            return Ending::plain(EndReason::Stopped);
                        }
                        continue;
                    };
                    let driving_now = *driving.borrow();
                    let sent = match message {
                        ClientMessage::Stop => return Ending::plain(EndReason::Stopped),
                        ClientMessage::TakeOver => match self.deps.screens.take_over(&self.grant, self.session).await {
                            Ok(TakeOver::Taken(taken)) => {
                                last_renew = tokio::time::Instant::now();
                                lease = Some(taken);
                                let _ = driving_sender.send(true);
                                self.state(sender, lease.as_ref(), surface).await
                            }
                            Ok(TakeOver::Busy(_)) => Self::error(sender, ErrorCode::DriverBusy, "someone else is driving").await,
                            Err(ScreenError::DriveNotAllowed) => Self::error(sender, ErrorCode::DriveNotAllowed, "you may only watch this computer").await,
                            Err(error) => return internal(&error),
                        },
                        ClientMessage::HandBack { note } => {
                            // Any of the driver's sockets hands back, also
                            // after the lease moved to another of their tabs.
                            if !may_hand_back(lease.as_ref(), &self.grant.user_id) {
                                Self::error(sender, ErrorCode::NotDriver, "you are not driving").await
                            } else {
                                let note = note.map(|note| note.chars().take(MAX_NOTE_CHARS).collect());
                                match self.deps.screens.hand_back(computer, self.grant.user_id.clone(), note).await {
                                    Ok(_) => {
                                        lease = None;
                                        injector = None;
                                        let _ = driving_sender.send(false);
                                        self.state(sender, None, surface).await
                                    }
                                    Err(error) => return internal(&error),
                                }
                            }
                        }
                        ClientMessage::Input { event } => {
                            if self.grant.mode != Mode::Drive || !driving_now {
                                // Dropped; said once per message so the viewer can show why.
                                Self::error(sender, ErrorCode::NotDriver, "input is dropped while you are not driving").await
                            } else {
                                match self.inject(&mut injector, &event).await {
                                    Ok(()) => {
                                        activity.notify_one();
                                        Ok(())
                                    }
                                    Err(error) => {
                                        injector = None;
                                        // The fleet's words stay in the log.
                                        tracing::warn!(error = %error, "could not type a driver's input");
                                        Self::error(sender, ErrorCode::InputFailed, "the computer didn't take the input").await
                                    }
                                }
                            }
                        }
                    };
                    if sent.is_err() {
                        return Ending::plain(EndReason::Stopped);
                    }
                }

                () = activity.notified() => {
                    if *driving.borrow() && last_renew.elapsed() >= RENEW_EVERY {
                        last_renew = tokio::time::Instant::now();
                        match self.deps.screens.renew(computer, self.session).await {
                            Ok(renewed) => {
                                if renewed.is_none() {
                                    lease = None;
                                    if self.state(sender, None, surface).await.is_err() {
                                        return Ending::plain(EndReason::Stopped);
                                    }
                                } else {
                                    lease = renewed;
                                }
                            }
                            Err(error) => return internal(&error),
                        }
                    }
                }

                changed = lease_changes.recv() => {
                    let relevant = match changed {
                        Ok(changed) => changed == computer,
                        Err(broadcast::error::RecvError::Lagged(_)) => true,
                        Err(broadcast::error::RecvError::Closed) => false,
                    };
                    if relevant {
                        lease = match self.deps.screens.lease(computer).await {
                            Ok(lease) => lease,
                            Err(error) => return internal(&error),
                        };
                        if self.state(sender, lease.as_ref(), surface).await.is_err() {
                            return Ending::plain(EndReason::Stopped);
                        }
                    }
                }

                changed = viewer_changes.recv() => {
                    if matches!(changed, Ok(changed) if changed == computer)
                        && self.state(sender, lease.as_ref(), surface).await.is_err()
                    {
                        return Ending::plain(EndReason::Stopped);
                    }
                }

                () = sleep_until_some(lapse) => {
                    lease = match self.deps.screens.lease(computer).await {
                        Ok(lease) => lease,
                        Err(error) => return internal(&error),
                    };
                    if self.state(sender, lease.as_ref(), surface).await.is_err() {
                        return Ending::plain(EndReason::Stopped);
                    }
                }

                _ = reauthorize.tick() => {
                    let allowed = match (self.deps.reauthorize)().await {
                        Some(allowed) => {
                            failed_checks = 0;
                            allowed
                        }
                        None => {
                            failed_checks += 1;
                            failed_checks < MAX_FAILED_ACCESS_CHECKS
                        }
                    };
                    if !allowed {
                        // A driver who lost access stops holding the agent now,
                        // not when the lease lapses.
                        if lease.as_ref().is_some_and(|lease| may_hand_back(Some(lease), &self.grant.user_id))
                            && let Err(error) = self.deps.screens.hand_back(computer, self.grant.user_id.clone(), None).await
                        {
                            tracing::warn!(error = ?error, "could not release a revoked driver's lease");
                        }
                        return Ending::plain(EndReason::AccessRevoked);
                    }
                    // Still here: keeps the computer from hibernating.
                    if let Err(error) = self.deps.screens.touch_session(self.session).await {
                        tracing::warn!(error = ?error, "could not mark the screen socket as open");
                    }
                }
            }
        }
    }

    /// Type `event` into the guest, connecting the injector on first use.
    async fn inject(
        &self,
        injector: &mut Option<RfbInjector>,
        event: &InputEvent,
    ) -> Result<(), String> {
        if injector.is_none() {
            *injector =
                Some(connect_injector(self.deps.tunnel.as_ref(), self.grant.computer_id).await?);
        }
        let Some(connected) = injector.as_mut() else {
            return Err("the computer's display is not connected".to_owned());
        };
        tokio::time::timeout(INJECTOR_HANDSHAKE_TIMEOUT, connected.send(event))
            .await
            .map_err(|_| "the computer's display did not take the input in time".to_owned())?
            .map_err(|error| error.to_string())
    }
}

/// The injector's own RFB connection to `computer`'s Xvnc. An Xvnc that
/// accepts but never speaks must not stall the socket's loop: the
/// handshake gets [`INJECTOR_HANDSHAKE_TIMEOUT`].
async fn connect_injector(
    tunnel: &dyn GuestTunnel,
    computer: ComputerId,
) -> Result<RfbInjector, String> {
    let stream = tunnel
        .open(computer, GuestPort::Rfb)
        .await
        .map_err(|error| error.to_string())?;
    tokio::time::timeout(INJECTOR_HANDSHAKE_TIMEOUT, RfbInjector::connect(stream))
        .await
        .map_err(|_| "the computer's display did not answer".to_owned())?
        .map_err(|error| error.to_string())
}

async fn sleep_until_some(at: Option<tokio::time::Instant>) {
    match at {
        Some(at) => tokio::time::sleep_until(at).await,
        None => std::future::pending().await,
    }
}

/// Whether `session` holds `lease`.
fn drives_here(lease: Option<&Lease>, session: SessionId) -> bool {
    lease.is_some_and(|lease| lease.session_id == session)
}

/// Whether `user` drives, from this socket or another.
fn may_hand_back(lease: Option<&Lease>, user: &MacroUserIdStr<'_>) -> bool {
    lease.is_some_and(|lease| lease.driver.user_id.as_ref() == user.as_ref())
}

/// Run `work`; if it takes longer than `after`, run `notice` first, once.
/// Returns what `work` gave and `notice`'s result (`Ok` when it didn't run).
async fn noticed_after<Output, NoticeError>(
    work: impl Future<Output = Output>,
    after: Duration,
    notice: impl Future<Output = Result<(), NoticeError>>,
) -> (Output, Result<(), NoticeError>) {
    tokio::pin!(work);
    match tokio::time::timeout(after, &mut work).await {
        Ok(output) => (output, Ok(())),
        Err(_) => {
            let told = notice.await;
            (work.await, told)
        }
    }
}

fn internal(error: &ScreenError) -> Ending {
    tracing::error!(error = ?error, "screen session failed");
    Ending::plain(EndReason::Error)
}

/// A media path that stopped short of the viewer leaving: what the fleet
/// says about the computer decides how it is told.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StoppedShort {
    /// The guest port closed cleanly.
    GuestClosed,
    /// The tunnel didn't start, failed, or broke.
    TunnelFailed,
}

/// How the socket ends when its media path does, or what to ask the fleet
/// first.
fn media_ending(ended: Result<MediaEnd, MediaError>) -> Result<Ending, StoppedShort> {
    match ended {
        Ok(MediaEnd::ViewerClosed) => Ok(Ending::plain(EndReason::Stopped)),
        Ok(MediaEnd::GuestClosed) => Err(StoppedShort::GuestClosed),
        // The fleet itself says the computer is gone.
        Err(MediaError::Tunnel(TunnelError::ComputerOff)) => {
            Ok(Ending::plain(EndReason::ComputerOff))
        }
        Err(MediaError::Tunnel(error @ (TunnelError::Unreachable(_) | TunnelError::Failed(_)))) => {
            tracing::warn!(error = %error, "the screen tunnel failed");
            Err(StoppedShort::TunnelFailed)
        }
        Err(MediaError::Io(error)) => {
            tracing::warn!(error = %error, tunnel_exited = TunnelExited::is(&error), "the screen tunnel broke");
            Err(StoppedShort::TunnelFailed)
        }
        Err(MediaError::Gate(error)) => Ok(Ending {
            reason: EndReason::Error,
            error: Some((ErrorCode::BadMessage, error.to_string())),
        }),
    }
}

/// How a media path that stopped short ends, given whether the computer
/// runs: a computer that doesn't is off; on one that does, the screen's
/// own failure is named. An unknown power is taken as running, so the
/// viewer sees the failure rather than a computer that may not be off.
fn stopped_short_ending(
    stopped: StoppedShort,
    power: Result<ComputerPower, TunnelError>,
) -> Ending {
    match power {
        Ok(ComputerPower::NotRunning) => return Ending::plain(EndReason::ComputerOff),
        Ok(ComputerPower::Running) => {}
        Err(error) => {
            tracing::warn!(error = %error, "could not tell whether the computer runs");
        }
    }
    match stopped {
        StoppedShort::GuestClosed => Ending {
            reason: EndReason::Error,
            error: Some((
                ErrorCode::SourceUnavailable,
                "the computer's screen closed".to_owned(),
            )),
        },
        StoppedShort::TunnelFailed => Ending {
            reason: EndReason::Error,
            error: Some((
                ErrorCode::TunnelFailed,
                "could not reach the computer's screen".to_owned(),
            )),
        },
    }
}
