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
    DriveEnd, EndReason, Lease, Mode, ScreenGrant, SessionId, Surface, TakeOver, Transport,
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
    DrivingUntil, FromViewer, MediaContext, MediaEnd, MediaError, MediaRun, ScreenMedia, ToViewer,
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
    /// Whether the viewer's tab is visible: sent on open, on every change,
    /// and repeated while visible.
    Visibility {
        visible: bool,
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
    /// The agent couldn't be paused on this computer, so this take-over
    /// was refused; a later one may work.
    AgentNotPausable,
    /// Whether this viewer may still drive couldn't be checked, so this
    /// take-over was refused; a later one may work.
    TakeOverUnavailable,
}

/// Who drives, as viewers see it: a name, never their user id (an email).
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ShownDriver<'a> {
    name: Option<&'a str>,
    /// Whether it is this viewer, from this tab or another.
    is_you: bool,
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
        driver: Option<ShownDriver<'a>>,
        /// The drive this lease belongs to: new at each take-over, the same
        /// across renewals and across the driver's tabs. Opaque.
        lease_id: Option<String>,
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
    /// When a quiet or hidden viewer's socket ends: [`IDLE`] outside tests.
    pub idle: Idle,
    pub shutdown: CancellationToken,
}

/// How long a socket lives without its viewer saying its tab is visible
/// (`visibility`, repeated by the viewer) or driving, and after the viewer
/// says it was hidden: a forgotten tab stops keeping the computer awake,
/// and a forgotten take-over hands back.
#[derive(Debug, Clone, Copy)]
pub struct Idle {
    pub after: Duration,
    pub hidden_for: Duration,
}

/// [`Idle`] outside tests.
pub const IDLE: Idle = Idle {
    after: Duration::from_secs(10 * 60),
    hidden_for: Duration::from_secs(2 * 60),
};

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

type Receiver = futures::stream::SplitStream<WebSocket>;

/// Media frames that may wait for a viewer; media waits once this many do.
const QUEUED_MEDIA: usize = 56;
/// Control messages that may wait for a viewer: far more than a burst of
/// lease changes and errors makes, so only a viewer that stopped reading
/// reaches it.
const QUEUED_CONTROL: usize = 256;
/// How long one message may take to reach a viewer before the viewer counts
/// as gone: a link this slow can't show a screen anyway.
const SEND_TIMEOUT: Duration = Duration::from_secs(10);

/// The viewer couldn't take another message: its outbox is full or its
/// writer gave up.
#[derive(Debug)]
struct Stalled;

/// A message on its way to the viewer, and what it counts as.
enum Outgoing {
    Media(Message),
    Control(Message),
}

/// The way to a viewer. Its own task writes the WebSocket, so a viewer that
/// stops reading never stalls the socket's loop (shutdown, access checks,
/// lease changes keep running): media waits while [`QUEUED_MEDIA`] frames
/// do, and a write that takes longer than [`SEND_TIMEOUT`] ends the socket.
/// Media and control share one queue, so they reach the viewer in order,
/// but are counted apart: control never waits behind the media limit.
struct Outbox {
    queue: mpsc::UnboundedSender<Outgoing>,
    media: Arc<std::sync::atomic::AtomicUsize>,
    control: Arc<std::sync::atomic::AtomicUsize>,
    stalled: CancellationToken,
}

impl Outbox {
    /// Write to `sink` from a task of its own, until the outbox is dropped.
    fn start<Sink>(mut sink: Sink) -> (Self, tokio::task::JoinHandle<()>)
    where
        Sink: futures::Sink<Message> + Unpin + Send + 'static,
    {
        use std::sync::atomic::Ordering;
        let (queue, mut pending) = mpsc::unbounded_channel::<Outgoing>();
        let media = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let control = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let stalled = CancellationToken::new();
        let (writer_media, writer_control, writer_stalled) =
            (Arc::clone(&media), Arc::clone(&control), stalled.clone());
        let writer = tokio::spawn(
            async move {
                while let Some(outgoing) = pending.recv().await {
                    let (message, count) = match outgoing {
                        Outgoing::Media(message) => (message, &writer_media),
                        Outgoing::Control(message) => (message, &writer_control),
                    };
                    let sent = tokio::time::timeout(SEND_TIMEOUT, sink.send(message)).await;
                    count.fetch_sub(1, Ordering::SeqCst);
                    match sent {
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
        (
            Self {
                queue,
                media,
                control,
                stalled,
            },
            writer,
        )
    }

    /// Queue a media frame; only after [`Self::has_room_for_media`].
    fn push_media(&self, message: Message) -> Result<(), Stalled> {
        self.media.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        self.queue
            .send(Outgoing::Media(message))
            .map_err(|_| Stalled)
    }

    /// Queue a control message; [`QUEUED_CONTROL`] waiting means the viewer
    /// is gone.
    fn push_control(&self, message: Message) -> Result<(), Stalled> {
        let queued = self
            .control
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if queued >= QUEUED_CONTROL {
            return Err(Stalled);
        }
        self.queue
            .send(Outgoing::Control(message))
            .map_err(|_| Stalled)
    }

    /// Whether media may queue another frame.
    fn has_room_for_media(&self) -> bool {
        self.media.load(std::sync::atomic::Ordering::SeqCst) < QUEUED_MEDIA
    }
}

async fn send(sender: &Outbox, message: &ServerMessage<'_>) -> Result<(), Stalled> {
    let text = serde_json::to_string(message).unwrap_or_default();
    sender.push_control(Message::Text(Utf8Bytes::from(text)))
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
    fn start_media(
        &self,
        driving: &watch::Receiver<DrivingUntil>,
        activity: &Arc<Notify>,
    ) -> MediaSlot {
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
                lease_id: lease.map(|lease| lease.drive_id().as_str().to_owned()),
                driver: lease.map(|lease| ShownDriver {
                    name: lease.driver.name.as_deref(),
                    is_you: lease.driver.user_id.as_ref() == self.grant.user_id.as_ref(),
                }),
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
        let (driving_sender, driving) = watch::channel(DrivingUntil::default());
        // The viewer's tab counts as visible on open.
        let mut visible_at = tokio::time::Instant::now();
        let mut hidden_at: Option<tokio::time::Instant> = None;
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
            let lapse = lease.as_ref().map(lapses_at);
            let _ = driving_sender.send(DrivingUntil(
                lapse.filter(|_| drives_here(lease.as_ref(), self.session)),
            ));
            let idle = self.deps.idle;
            let idle_at = hidden_at.map_or(visible_at + idle.after, |hidden| {
                (hidden + idle.hidden_for).min(visible_at + idle.after)
            });
            let MediaSlot {
                run,
                to_viewer,
                from_viewer,
            } = &mut media;

            tokio::select! {
                () = self.deps.shutdown.cancelled() => return Ending::plain(EndReason::Shutdown),

                () = tokio::time::sleep_until(idle_at) => {
                    // A forgotten take-over gives the agent back.
                    if may_hand_back(lease.as_ref(), &self.grant.user_id)
                        && drives_here(lease.as_ref(), self.session)
                        && let Err(error) = self.deps.screens.hand_back(computer, self.grant.user_id.clone(), None).await
                    {
                        tracing::warn!(error = ?error, "could not release an idle driver's lease");
                    }
                    return Ending::plain(EndReason::Idle);
                }

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
                    if sender.push_media(message).is_err() {
                        return Ending::plain(EndReason::Stopped);
                    }
                }

                incoming = receiver.next() => {
                    let text = match incoming {
                        None | Some(Err(_)) | Some(Ok(Message::Close(_))) => return Ending::plain(EndReason::Stopped),
                        Some(Ok(Message::Binary(bytes))) => {
                            self.bytes_from_viewer += bytes.len() as u64;
                            // A guest that stopped reading the viewer's bytes must
                            // not hold the loop.
                            match tokio::time::timeout(SEND_TIMEOUT, from_viewer.send(FromViewer::Binary(bytes))).await {
                                Ok(_) => {}
                                Err(_) => {
                                    return Ending {
                                        reason: EndReason::Error,
                                        error: Some((ErrorCode::TunnelFailed, "the computer's screen stopped taking input".to_owned())),
                                    };
                                }
                            }
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
                    // Taking over is when a demoted admin must not slip
                    // through before the next periodic recheck; a check that
                    // couldn't be made refuses the take-over, not the socket.
                    let message = if matches!(message, ClientMessage::TakeOver) {
                        match (self.deps.reauthorize)().await {
                            Some(true) => Some(message),
                            Some(false) => return Ending::plain(EndReason::AccessRevoked),
                            None => {
                                if Self::error(sender, ErrorCode::TakeOverUnavailable, "Couldn't check that you may take over; try again.").await.is_err() {
                                    return Ending::plain(EndReason::Stopped);
                                }
                                None
                            }
                        }
                    } else {
                        Some(message)
                    };
                    let Some(message) = message else {
                        continue;
                    };
                    let driving_now = driving.borrow().now();
                    let sent = match message {
                        ClientMessage::Stop => return Ending::plain(EndReason::Stopped),
                        ClientMessage::Visibility { visible } => {
                            if visible {
                                visible_at = tokio::time::Instant::now();
                                hidden_at = None;
                            } else {
                                hidden_at.get_or_insert_with(tokio::time::Instant::now);
                            }
                            Ok(())
                        }
                        ClientMessage::TakeOver => match self.deps.screens.take_over(&self.grant, self.session).await {
                            Ok(TakeOver::Taken(taken)) => {
                                last_renew = tokio::time::Instant::now();
                                visible_at = last_renew;
                                let _ = driving_sender.send(DrivingUntil(Some(lapses_at(&taken))));
                                lease = Some(taken);
                                self.state(sender, lease.as_ref(), surface).await
                            }
                            Ok(TakeOver::Busy(_)) => Self::error(sender, ErrorCode::DriverBusy, "someone else is driving").await,
                            Err(ScreenError::DriveNotAllowed) => Self::error(sender, ErrorCode::DriveNotAllowed, "you may only watch this computer").await,
                            Err(ScreenError::AgentNotPausable) => Self::error(
                                sender,
                                ErrorCode::AgentNotPausable,
                                "Couldn't pause the agent on this computer, so it can't be taken over right now.",
                            ).await,
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
                                        let _ = driving_sender.send(DrivingUntil::default());
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
                                visible_at = tokio::time::Instant::now();
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
                    // Raw input reached the guest: its tab is in use.
                    visible_at = tokio::time::Instant::now();
                    if driving.borrow().now() && last_renew.elapsed() >= RENEW_EVERY {
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
                        let was_driving = lease.clone().filter(|lease| lease.session_id == self.session);
                        lease = match self.deps.screens.lease(computer).await {
                            Ok(lease) => lease,
                            Err(error) => return internal(&error),
                        };
                        if self.state(sender, lease.as_ref(), surface).await.is_err() {
                            return Ending::plain(EndReason::Stopped);
                        }
                        // The agent couldn't be kept paused: say why the
                        // drive ended, so the viewer doesn't claim it is.
                        if let Some(ended) = was_driving.filter(|_| !drives_here(lease.as_ref(), self.session))
                            && matches!(self.deps.screens.drive_end(&ended).await, Ok(Some(DriveEnd::Unpaused)))
                            && Self::error(sender, ErrorCode::AgentNotPausable, "The agent couldn't be kept paused, so it has the computer back.").await.is_err()
                        {
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

/// When `lease` lapses, on this process's clock.
fn lapses_at(lease: &Lease) -> tokio::time::Instant {
    let left = (lease.expires_at - chrono::Utc::now())
        .to_std()
        .unwrap_or(Duration::ZERO);
    tokio::time::Instant::now() + left
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
