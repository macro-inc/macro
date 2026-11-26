//! Byte tunnels to loopback ports in a computer's guest, over the fleet's
//! exec: a shell that prints a ready line with its pid and becomes
//! `socat -t 1 STDIO TCP:127.0.0.1:<port>,nodelay`, run as the guest's
//! `macro` user. A tunnel whose session ended is killed if it doesn't exit.
//! Nothing in the guest listens off loopback, and only [`GuestPort`]s can be
//! opened.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use hosted_runtimes::domain::ids::ComputerId;
use tokio::io::{AsyncRead, AsyncReadExt as _, AsyncWrite};
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::telemetry::{RelayProgress, RelayStage};

#[cfg(test)]
mod test;

/// The guest ports a screen may reach.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuestPort {
    /// The agent desktop's Xvnc (RFB, display `:1`).
    Rfb,
}

impl GuestPort {
    /// Its loopback port in the guest.
    pub fn port(self) -> u16 {
        match self {
            Self::Rfb => 5901,
        }
    }

    fn name(self) -> &'static str {
        match self {
            Self::Rfb => "rfb",
        }
    }
}

/// One open tunnel: what the guest port sends, and what goes to it.
pub type GuestStream =
    tokio::io::Join<Pin<Box<dyn AsyncRead + Send>>, Pin<Box<dyn AsyncWrite + Send>>>;

/// Why a tunnel didn't open.
#[derive(Debug, thiserror::Error)]
pub enum TunnelError {
    /// The computer is asleep, off, gone or moving.
    #[error("the computer is not running")]
    ComputerOff,
    /// The fleet could not run the tunnel.
    #[error("could not reach the computer: {0}")]
    Unreachable(String),
    /// No shell marker arrived.
    #[error("the screen tunnel did not start")]
    MissingMarker,
    /// The guest did not send its shell marker before the deadline.
    #[error("the screen tunnel did not start in time")]
    Timeout,
}

/// Why the tunnel was opened.
pub enum TunnelRole {
    /// Relays VNC traffic between the guest and a viewer.
    Relay(Arc<RelayProgress>),
    /// Sends typed input to the guest through a separate RFB connection.
    Input,
}

impl TunnelRole {
    fn name(&self) -> &'static str {
        match self {
            Self::Relay(_) => "relay",
            Self::Input => "input",
        }
    }
}

/// Opens [`GuestStream`]s. Object-safe (`Arc<dyn GuestTunnel>`), hence the
/// boxed future.
pub trait GuestTunnel: Send + Sync + 'static {
    /// Open `port` on `computer`'s guest.
    fn open(
        &self,
        computer: ComputerId,
        port: GuestPort,
        role: TunnelRole,
    ) -> Pin<Box<dyn Future<Output = Result<GuestStream, TunnelError>> + Send + '_>>;
}

/// A program running in a guest, as [`GuestExec`] started it.
pub struct GuestProgram {
    /// Its stdin; dropping it closes the program's stdin.
    pub stdin: Pin<Box<dyn AsyncWrite + Send>>,
    /// Its stdout.
    pub stdout: Pin<Box<dyn AsyncRead + Send>>,
    /// Its exit code, once it ended and stdout is drained.
    pub exit: Pin<Box<dyn Future<Output = Result<i32, String>> + Send>>,
}

/// Runs a program as the guest's `macro` user: the fleet's exec, behind a
/// trait so the screen needs no particular operator.
pub trait GuestExec: Send + Sync + 'static {
    /// Run `argv` in `computer`'s guest.
    fn exec<'a>(
        &'a self,
        computer: ComputerId,
        argv: &'a [&'a str],
    ) -> Pin<Box<dyn Future<Output = Result<GuestProgram, TunnelError>> + Send + 'a>>;
}

/// Whether a computer is up for its screen, as [`ScreenWaker`] found it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Woken {
    /// It was awake, or woke and its runtime connected.
    Up,
    /// It is still waking (no room on its host yet, or slow to boot).
    StillWaking,
}

/// Whether a computer runs, as its lifecycle says: what a screen that
/// stopped short is told about.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputerPower {
    /// Running and awake.
    Running,
    /// Off, starting, stopping, crashed, hibernated or gone.
    NotRunning,
}

/// The fleet's side of a screen: waking a hibernated computer before its
/// screen opens (the operator's dispatch wake), and whether it runs when
/// the screen stops short. Object-safe (`Arc<dyn ScreenWaker>`), hence the
/// boxed futures.
pub trait ScreenWaker: Send + Sync + 'static {
    /// Wake the computer behind `harness`, waiting a while for it.
    fn wake(
        &self,
        harness: harness_id::HarnessId,
    ) -> Pin<Box<dyn Future<Output = Result<Woken, TunnelError>> + Send + '_>>;

    /// Whether `computer` runs now.
    fn power(
        &self,
        computer: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<ComputerPower, TunnelError>> + Send + '_>>;

    /// Every computer that runs now, in one read.
    fn awake(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<std::collections::HashSet<ComputerId>, TunnelError>>
                + Send
                + '_,
        >,
    >;
}

/// [`GuestTunnel`] over a [`GuestExec`]; the tasks that end tunnels which
/// outlived their sessions run on `tasks`.
pub struct FleetTunnel {
    exec: Arc<dyn GuestExec>,
    tasks: TaskTracker,
}

impl FleetTunnel {
    /// Tunnel through `exec`; reap on `tasks`.
    pub fn new(exec: Arc<dyn GuestExec>, tasks: TaskTracker) -> Self {
        Self { exec, tasks }
    }
}

/// What the tunnel's shell prints once it runs, before `socat` takes over
/// stdout, followed by its pid: anything else (a fleet's own error, say)
/// is never media.
const READY_PREFIX: &[u8] = b"macro-screen-tunnel-ready ";
/// The longest ready line: the prefix, a pid and the newline.
const READY_LINE_MAX: usize = 48;
/// How long the guest may take to start the tunnel.
const READY_TIMEOUT: Duration = Duration::from_secs(20);
/// How long a closed tunnel may take to exit on its own before it is
/// killed: socat stops `-t 1` after its stdin ends, when the fleet passes
/// that end on.
const EXIT_GRACE: Duration = Duration::from_secs(2);
/// How long the kill of a lingering tunnel may take.
const KILL_TIMEOUT: Duration = Duration::from_secs(10);
/// Kill pid `$1` only if it is still this tunnel's socat to port `$2`: a
/// pid the guest reused in the meantime belongs to another program, whose
/// command line differs.
const KILL_SCRIPT: &str = r#"[ "$(tr '\0' ' ' < "/proc/$1/cmdline" 2>/dev/null)" = "socat -t 1 STDIO TCP:127.0.0.1:$2,nodelay " ] && kill "$1""#;
/// Before RFB, report the shell marker. Only the fixed refusal status may
/// leave the stderr filter. The helper keeps the reported pid for the reaper.
const TUNNEL_SCRIPT: &str = include_str!("tunnel/relay.sh");

/// Reserved exit status from the script's stderr classifier.
const CONNECT_REFUSED: i32 = 111;

#[derive(Debug, thiserror::Error)]
pub(super) enum TunnelExited {
    #[error("the screen port refused the connection")]
    ConnectRefused,
    #[error("the screen tunnel exited with {0}")]
    Code(i32),
    #[error("the screen tunnel exit status is unknown")]
    Failed,
}

impl TunnelExited {
    pub(super) fn from_io(error: &std::io::Error) -> Option<&Self> {
        error.get_ref()?.downcast_ref()
    }
}

/// The guest side of a tunnel: its stdout, then at the end its exit code,
/// so a tunnel that failed reads as an error and not as the port closing.
/// Dropped before the program ended, it makes sure the program ends.
struct ExitChecked {
    stdout: Pin<Box<dyn AsyncRead + Send>>,
    exit: Option<ProgramExit>,
    reaper: Reaper,
}

/// How a guest program exits, as the fleet tells it.
type ProgramExit = Pin<Box<dyn Future<Output = Result<i32, String>> + Send>>;

/// Ends a tunnel's guest program that outlived its session: not every
/// fleet passes a closed stdin on to the program in the guest, and the
/// fleet's exec ending (Docker's client exits when its stdin closes) says
/// nothing about the program.
#[derive(Clone)]
struct Reaper {
    exec: Arc<dyn GuestExec>,
    tasks: TaskTracker,
    computer: ComputerId,
    port: GuestPort,
    pid: u32,
}

impl Reaper {
    /// Give the program [`EXIT_GRACE`] to finish on its own, then end it
    /// whatever the fleet said, if its pid is still this tunnel's socat
    /// ([`KILL_SCRIPT`]); at most [`KILL_TIMEOUT`].
    async fn reap(self, exit: ProgramExit) {
        let mut exit = exit;
        let exited = tokio::time::timeout(EXIT_GRACE, &mut exit).await.is_ok();
        let pid = self.pid.to_string();
        let port = self.port.port().to_string();
        let killed = tokio::time::timeout(KILL_TIMEOUT, async {
            let kill = self
                .exec
                .exec(
                    self.computer,
                    &["sh", "-c", KILL_SCRIPT, "sh", pid.as_str(), port.as_str()],
                )
                .await?;
            drop(kill.stdin);
            let _ = kill.exit.await;
            Ok::<_, TunnelError>(())
        })
        .await;
        match killed {
            Ok(Ok(())) => {}
            Ok(Err(_)) => tracing::warn!("could not end a screen tunnel"),
            Err(_) => tracing::warn!("ending a screen tunnel timed out"),
        }
        if !exited && tokio::time::timeout(EXIT_GRACE, exit).await.is_err() {
            tracing::warn!(pid = self.pid, "a screen tunnel outlived its kill");
        }
    }
}

impl AsyncRead for ExitChecked {
    fn poll_read(
        self: Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
        buffer: &mut tokio::io::ReadBuf<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        use std::task::Poll;
        let this = self.get_mut();
        let before = buffer.filled().len();
        match this.stdout.as_mut().poll_read(context, buffer) {
            Poll::Ready(Ok(())) => {}
            other => return other,
        }
        if buffer.filled().len() > before || buffer.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }
        // The end of stdout: how did the tunnel end?
        let Some(exit) = this.exit.as_mut() else {
            return Poll::Ready(Ok(()));
        };
        let Poll::Ready(code) = exit.as_mut().poll(context) else {
            return Poll::Pending;
        };
        this.exit = None;
        Poll::Ready(match code {
            Ok(0) => Ok(()),
            Ok(CONNECT_REFUSED) => Err(std::io::Error::other(TunnelExited::ConnectRefused)),
            Ok(code) => Err(std::io::Error::other(TunnelExited::Code(code))),
            Err(_) => Err(std::io::Error::other(TunnelExited::Failed)),
        })
    }
}

impl Drop for ExitChecked {
    fn drop(&mut self) {
        // The program is still running: its stdin closes with this stream;
        // give it a moment to exit, then end it.
        if let Some(exit) = self.exit.take()
            && tokio::runtime::Handle::try_current().is_ok()
        {
            let reaper = self.reaper.clone();
            self.reaper.tasks.spawn(reaper.reap(exit).in_current_span());
        }
    }
}

/// Read the tunnel's ready line from `stdout` and return the program's
/// pid. Anything else is discarded without tracing process output.
async fn ready(stdout: &mut Pin<Box<dyn AsyncRead + Send>>) -> Result<u32, TunnelError> {
    let mut seen = Vec::with_capacity(READY_LINE_MAX);
    let read = async {
        while seen.len() < READY_LINE_MAX && seen.last() != Some(&b'\n') {
            let mut byte = [0u8; 1];
            match stdout.read(&mut byte).await {
                Ok(0) | Err(_) => break,
                Ok(_) => seen.extend_from_slice(&byte),
            }
            let compared = seen.len().min(READY_PREFIX.len());
            if seen.get(..compared) != READY_PREFIX.get(..compared) {
                break;
            }
        }
    };
    if tokio::time::timeout(READY_TIMEOUT, read).await.is_err() {
        return Err(TunnelError::Timeout);
    }
    if let Some(pid) = seen
        .strip_prefix(READY_PREFIX)
        .and_then(|rest| rest.strip_suffix(b"\n"))
        .and_then(|pid| std::str::from_utf8(pid).ok())
        .and_then(|pid| pid.parse::<u32>().ok())
    {
        return Ok(pid);
    }
    Err(TunnelError::MissingMarker)
}

impl GuestTunnel for FleetTunnel {
    fn open(
        &self,
        computer: ComputerId,
        port: GuestPort,
        role: TunnelRole,
    ) -> Pin<Box<dyn Future<Output = Result<GuestStream, TunnelError>> + Send + '_>> {
        let span = tracing::info_span!(
            "computer.screen.tunnel",
            computer.id = %computer,
            computer.screen.port = port.name(),
            screen.role = role.name(),
            computer.guest.image = tracing::field::Empty,
            otel.status_code = tracing::field::Empty,
        );
        Box::pin(
            async move {
                let port_number = port.port().to_string();
                let mut process = self
                    .exec
                    .exec(
                        computer,
                        &["bash", "-c", TUNNEL_SCRIPT, "bash", port_number.as_str()],
                    )
                    .await
                    .inspect_err(|_| {
                        tracing::Span::current().record("otel.status_code", "ERROR");
                    })?;
                if let TunnelRole::Relay(progress) = &role {
                    progress.advance(RelayStage::WaitingForShellMarker);
                }
                // Nothing reaches the viewer until the tunnel says it runs.
                let pid = ready(&mut process.stdout).await.inspect_err(|_| {
                    tracing::Span::current().record("otel.status_code", "ERROR");
                })?;
                tracing::info!("computer.screen.shell_marker");
                let stdout: Pin<Box<dyn AsyncRead + Send>> = Box::pin(ExitChecked {
                    stdout: process.stdout,
                    exit: Some(process.exit),
                    reaper: Reaper {
                        exec: Arc::clone(&self.exec),
                        tasks: self.tasks.clone(),
                        computer,
                        port,
                        pid,
                    },
                });
                Ok(tokio::io::join(stdout, process.stdin))
            }
            .instrument(span),
        )
    }
}
