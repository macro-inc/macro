//! Spawning and supervising the ACP child process.
//!
//! This is a local port of the SDK's `AcpAgent` (`agent-client-protocol`,
//! `src/acp_agent.rs`, at the rev pinned in the workspace `Cargo.toml`). It
//! exists because `AcpAgentConfig` is exactly `{command, args, env}` and the
//! SDK's spawn path never calls `Command::current_dir`, so the only ways to
//! give the child a working directory were mutating the daemon's own cwd or a
//! `/bin/sh -c 'cd …'` wrapper. Here the daemon owns the
//! `std::process::Command`, sets `current_dir` and the process group directly,
//! and hands the pipes to the SDK's public [`Lines`] transport - the same seam
//! `AcpAgent` itself connects through. `ByteStreams` is not usable here: it
//! wraps the line layer internally, and the debug tap and the stdout-EOF
//! signal both hook individual lines.
//!
//! Everything other than the spawn is kept behaviour-for-behaviour with
//! `AcpAgent::connect_to`, and must be re-read against it whenever the SDK
//! pin moves:
//! - process-group kill on drop ([`ChildGuard`]), created before the first poll
//!   so cancelling the connection early still tears the group down;
//! - continuous stderr draining with a bounded tail ([`StderrTail`]) that is
//!   reported together with a nonzero exit status;
//! - the per-line debug tap on stdin, stdout and stderr;
//! - the stdout-EOF signal that bounds a final stdin write once the child has
//!   half-closed stdout ([`write_line_with_shutdown_timeout`]);
//! - the grace periods around protocol shutdown and child exit.
//!
//! Deliberately not ported: the Windows `CREATE_NO_WINDOW` creation flag.
//! `macrod` is itself a console program, so a console child inherits its
//! console rather than opening a new one.
//!
//! If the SDK ever grows a working-directory option on `AcpAgentConfig`,
//! delete this module and go back to `AcpAgent`.

use std::collections::BTreeMap;
use std::collections::VecDeque;
use std::path::PathBuf;
use std::pin::pin;
use std::sync::Arc;
use std::time::Duration;

use agent_client_protocol::util::internal_error;
use agent_client_protocol::{Agent, Client, ConnectTo, Error, LineDirection, Lines};
use tokio::process::{Child, ChildStderr, ChildStdin, ChildStdout};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

#[cfg(test)]
mod test;

type DebugCallback = Arc<dyn Fn(&str, LineDirection) + Send + Sync + 'static>;

const STDERR_CAPTURE_LIMIT: usize = 64 * 1024;
const STDERR_READ_BUFFER_SIZE: usize = 8 * 1024;
const STDERR_LINE_TRUNCATION_MARKER: &str = "… [stderr line truncated]";
const SHUTDOWN_GRACE_PERIOD: Duration = Duration::from_secs(1);

/// An ACP agent launched as a child of this daemon, in a chosen directory.
///
/// The child inherits the daemon's environment. Connecting it (via
/// [`ConnectTo`]) spawns the process and supervises it for the life of the
/// connection.
pub(crate) struct AcpProcess {
    command: PathBuf,
    args: Vec<String>,
    cwd: PathBuf,
    env: BTreeMap<String, String>,
    debug_callback: Option<DebugCallback>,
}

impl AcpProcess {
    pub(crate) fn new(
        command: impl Into<PathBuf>,
        args: Vec<String>,
        cwd: impl Into<PathBuf>,
    ) -> Self {
        Self {
            command: command.into(),
            args,
            cwd: cwd.into(),
            env: BTreeMap::new(),
            debug_callback: None,
        }
    }

    /// Add environment variables on top of the ones this process already has.
    ///
    /// The npm ACP adapters bundle their own copy of the CLI they wrap and
    /// take an absolute path to the one to run instead - `CODEX_PATH`,
    /// `CLAUDE_CODE_EXECUTABLE` - so the bridge and the model probe must be
    /// given the same variables or they inspect one CLI and run another.
    #[must_use]
    pub(crate) fn envs(mut self, env: impl IntoIterator<Item = (String, String)>) -> Self {
        self.env.extend(env);
        self
    }

    /// Observe every line crossing the child's stdin and stdout, plus its
    /// stderr. Exceptionally long stderr lines are truncated.
    #[must_use]
    pub(crate) fn with_debug<Callback>(mut self, callback: Callback) -> Self
    where
        Callback: Fn(&str, LineDirection) + Send + Sync + 'static,
    {
        self.debug_callback = Some(Arc::new(callback));
        self
    }

    fn spawn(&self) -> Result<SpawnedChild, Error> {
        let mut command = std::process::Command::new(&self.command);
        command
            .args(&self.args)
            .current_dir(&self.cwd)
            .envs(&self.env)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt as _;

            // The child leads its own process group so `ChildGuard` can kill
            // the whole tree. Agents commonly sit behind wrapper launchers
            // (`npx …`, `uvx …`): killing only the immediate child orphans the
            // real agent, which re-parents to pid 1 and does not reliably exit
            // on stdin EOF.
            command.process_group(0);
        }

        let mut child = tokio::process::Command::from(command)
            .spawn()
            .map_err(|error| internal_error(format!("Failed to spawn process: {error}")))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| internal_error("Failed to open stdin"))?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| internal_error("Failed to open stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| internal_error("Failed to open stderr"))?;

        Ok(SpawnedChild {
            stdin,
            stdout,
            stderr,
            guard: ChildGuard::new(child),
        })
    }
}

struct SpawnedChild {
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    guard: ChildGuard,
}

/// Kills the child - and, on Unix, its whole process group - when dropped.
struct ChildGuard {
    child: Child,
    /// Captured at spawn: tokio forgets the pid once the child is reaped, and
    /// the group kill must still reach descendants a wrapper left behind.
    #[cfg(unix)]
    process_group: Option<rustix::process::Pid>,
}

impl ChildGuard {
    fn new(child: Child) -> Self {
        #[cfg(unix)]
        let process_group = child
            .id()
            .and_then(|id| rustix::process::Pid::from_raw(id.cast_signed()));
        Self {
            child,
            #[cfg(unix)]
            process_group,
        }
    }

    async fn wait(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.child.wait().await
    }

    fn terminate(&mut self) {
        // SIGKILL the group first: it reaches grandchildren spawned by wrapper
        // launchers, and also the case where the direct child already exited
        // but its wrapper left the real agent running. An error (`ESRCH`)
        // just means the group is already gone.
        #[cfg(unix)]
        if let Some(process_group) = self.process_group {
            let _result =
                rustix::process::kill_process_group(process_group, rustix::process::Signal::KILL);
        }
        // Fallback for platforms without group semantics, and a no-op double
        // tap on Unix.
        drop(self.child.start_kill());
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[derive(Default)]
struct StderrTail {
    bytes: VecDeque<u8>,
    truncated: bool,
}

impl StderrTail {
    fn push(&mut self, bytes: &[u8]) {
        if bytes.len() >= STDERR_CAPTURE_LIMIT {
            self.truncated |= !self.bytes.is_empty() || bytes.len() > STDERR_CAPTURE_LIMIT;
            self.bytes.clear();
            self.bytes
                .extend(bytes[bytes.len() - STDERR_CAPTURE_LIMIT..].iter().copied());
            return;
        }

        let overflow = self
            .bytes
            .len()
            .saturating_add(bytes.len())
            .saturating_sub(STDERR_CAPTURE_LIMIT);
        if overflow > 0 {
            self.truncated = true;
            drop(self.bytes.drain(..overflow));
        }
        self.bytes.extend(bytes.iter().copied());
    }

    fn into_string(mut self) -> String {
        let truncated = self.truncated;
        let stderr = String::from_utf8_lossy(self.bytes.make_contiguous());
        if truncated {
            format!("[stderr truncated; showing last {STDERR_CAPTURE_LIMIT} bytes]\n{stderr}")
        } else {
            stderr.into_owned()
        }
    }
}

#[derive(Default)]
struct StderrDebugLines {
    current: Vec<u8>,
    truncated: bool,
    pending_carriage_return: bool,
}

impl StderrDebugLines {
    fn push(&mut self, bytes: &[u8], callback: &DebugCallback) {
        for &byte in bytes {
            if self.pending_carriage_return {
                if byte == b'\n' {
                    self.pending_carriage_return = false;
                    self.emit(callback);
                    continue;
                }

                self.push_byte(b'\r');
                self.pending_carriage_return = false;
            }

            match byte {
                b'\r' => self.pending_carriage_return = true,
                b'\n' => self.emit(callback),
                byte => self.push_byte(byte),
            }
        }
    }

    fn finish(&mut self, callback: &DebugCallback) {
        if self.pending_carriage_return {
            self.push_byte(b'\r');
            self.pending_carriage_return = false;
        }
        if !self.current.is_empty() || self.truncated {
            self.emit(callback);
        }
    }

    fn push_byte(&mut self, byte: u8) {
        if self.current.len() < STDERR_CAPTURE_LIMIT {
            self.current.push(byte);
        } else {
            self.truncated = true;
        }
    }

    fn emit(&mut self, callback: &DebugCallback) {
        let line = String::from_utf8_lossy(&self.current);

        if self.truncated {
            let mut line = line.into_owned();
            line.push_str(STDERR_LINE_TRUNCATION_MARKER);
            callback(&line, LineDirection::Stderr);
        } else {
            callback(line.as_ref(), LineDirection::Stderr);
        }

        self.current.clear();
        self.truncated = false;
    }
}

struct StderrDrainResult {
    captured: String,
    read_error: Option<std::io::Error>,
}

/// Read stderr to EOF. Never leaving the pipe unread matters: a full pipe
/// buffer blocks the child.
async fn drain_stderr(
    mut stderr: impl futures::AsyncRead + Unpin,
    debug_callback: Option<DebugCallback>,
) -> StderrDrainResult {
    use futures::AsyncReadExt as _;

    let mut tail = StderrTail::default();
    let mut debug_lines = debug_callback.as_ref().map(|_| StderrDebugLines::default());
    let mut buffer = [0; STDERR_READ_BUFFER_SIZE];

    let read_error = loop {
        match stderr.read(&mut buffer).await {
            Ok(0) => break None,
            Ok(read) => {
                let bytes = &buffer[..read];
                tail.push(bytes);
                if let (Some(lines), Some(callback)) =
                    (debug_lines.as_mut(), debug_callback.as_ref())
                {
                    lines.push(bytes, callback);
                }
            }
            Err(error) => break Some(error),
        }
    };

    if let (Some(lines), Some(callback)) = (debug_lines.as_mut(), debug_callback.as_ref()) {
        lines.finish(callback);
    }

    StderrDrainResult {
        captured: tail.into_string(),
        read_error,
    }
}

struct ExitedChild {
    guard: ChildGuard,
    status: std::process::ExitStatus,
    stderr_rx: futures::channel::oneshot::Receiver<String>,
}

/// Wait for the direct child while retaining its process-group guard and
/// stderr receiver for exit reporting.
async fn wait_for_child(
    mut guard: ChildGuard,
    stderr_rx: futures::channel::oneshot::Receiver<String>,
) -> Result<ExitedChild, Error> {
    let status = guard
        .wait()
        .await
        .map_err(|error| internal_error(format!("Failed to wait for process: {error}")))?;

    Ok(ExitedChild {
        guard,
        status,
        stderr_rx,
    })
}

/// Report an observed child exit, including the bounded stderr tail for a
/// nonzero status.
async fn finish_child_exit(child: ExitedChild) -> Result<(), Error> {
    let ExitedChild {
        mut guard,
        status,
        stderr_rx,
    } = child;

    // A launcher may exit while a descendant remains alive holding inherited
    // stdio. Terminate the rest of the group before waiting for stderr EOF.
    guard.terminate();

    if status.success() {
        return Ok(());
    }

    let grace = pin!(tokio::time::sleep(SHUTDOWN_GRACE_PERIOD));
    let stderr = match futures::future::select(stderr_rx, grace).await {
        futures::future::Either::Left((stderr, _)) => stderr.unwrap_or_default(),
        futures::future::Either::Right((_, stderr_rx)) => {
            tracing::debug!(
                grace = ?SHUTDOWN_GRACE_PERIOD,
                "agent stderr remained open after process exit; reporting status without it"
            );
            drop(stderr_rx);
            String::new()
        }
    };

    let message = if stderr.is_empty() {
        format!("Process exited with {status}")
    } else {
        format!("Process exited with {status}: {stderr}")
    };

    Err(internal_error(message))
}

async fn await_protocol_shutdown_after_successful_child_exit<Protocol>(
    protocol_future: Protocol,
    grace: Duration,
) -> Result<(), Error>
where
    Protocol: Future<Output = Result<(), Error>> + Unpin,
{
    let timer = pin!(tokio::time::sleep(grace));
    match futures::future::select(protocol_future, timer).await {
        futures::future::Either::Left((result, _)) => result,
        futures::future::Either::Right((_, protocol_future)) => {
            tracing::debug!(
                ?grace,
                "protocol transport remained open after successful agent process exit; stopping it"
            );
            drop(protocol_future);
            Ok(())
        }
    }
}

async fn write_line<Writer>(writer: &mut Writer, line: String) -> std::io::Result<()>
where
    Writer: futures::AsyncWrite + Unpin + ?Sized,
{
    use futures::AsyncWriteExt as _;

    let mut bytes = line.into_bytes();
    bytes.push(b'\n');
    writer.write_all(&bytes).await?;
    writer.flush().await
}

async fn write_line_with_shutdown_timeout<Writer>(
    writer: &mut Writer,
    line: String,
    stdout_eof_rx: &mut Option<futures::channel::oneshot::Receiver<()>>,
    stdout_eof_seen: &mut bool,
    grace: Duration,
) -> std::io::Result<()>
where
    Writer: futures::AsyncWrite + Unpin + ?Sized,
{
    let write = Box::pin(write_line(writer, line));

    if *stdout_eof_seen {
        return await_write_during_shutdown(write, grace).await;
    }

    let Some(stdout_eof) = stdout_eof_rx.as_mut() else {
        return write.await;
    };

    match futures::future::select(write, stdout_eof).await {
        futures::future::Either::Left((result, _)) => result,
        futures::future::Either::Right((stdout_eof, write)) => {
            *stdout_eof_rx = None;
            if stdout_eof.is_err() {
                // Dropping the incoming stream cancels the signal. Only an
                // explicit send represents a clean EOF.
                return write.await;
            }

            *stdout_eof_seen = true;
            await_write_during_shutdown(write, grace).await
        }
    }
}

async fn await_write_during_shutdown<Write>(write: Write, grace: Duration) -> std::io::Result<()>
where
    Write: Future<Output = std::io::Result<()>> + Unpin,
{
    let timer = pin!(tokio::time::sleep(grace));
    match futures::future::select(write, timer).await {
        futures::future::Either::Left((result, _)) => result,
        futures::future::Either::Right((_, write)) => {
            tracing::debug!(
                ?grace,
                "pending protocol output did not drain after agent stdout closed"
            );
            drop(write);
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!(
                    "Agent closed its protocol output but pending protocol output did not drain within {grace:?}"
                ),
            ))
        }
    }
}

impl ConnectTo<Client> for AcpProcess {
    async fn connect_to(self, client: impl ConnectTo<Agent>) -> Result<(), Error> {
        use futures::io::BufReader;
        use futures::{AsyncBufReadExt as _, StreamExt as _};

        let SpawnedChild {
            stdin,
            stdout,
            stderr,
            guard,
        } = self.spawn()?;

        let (stderr_tx, stderr_rx) = futures::channel::oneshot::channel::<String>();

        // Raced against the protocol below, so it runs on this task.
        let debug_callback = self.debug_callback.clone();
        let stderr_future = async move {
            let StderrDrainResult {
                captured,
                read_error,
            } = drain_stderr(stderr.compat(), debug_callback).await;
            drop(stderr_tx.send(captured));

            if let Some(error) = read_error {
                tracing::warn!(
                    ?error,
                    "failed to read process stderr; stderr will no longer be captured"
                );
            }
        };

        // The guard already exists, so cancelling this connection before the
        // monitor is first polled still terminates the whole process group.
        let child_wait = wait_for_child(guard, stderr_rx);

        let incoming_lines: std::pin::Pin<
            Box<dyn futures::Stream<Item = std::io::Result<String>> + Send>,
        > = if let Some(callback) = self.debug_callback.clone() {
            Box::pin(
                BufReader::new(stdout.compat())
                    .lines()
                    .inspect(move |result| {
                        if let Ok(line) = result {
                            callback(line, LineDirection::Stdout);
                        }
                    }),
            )
        } else {
            Box::pin(BufReader::new(stdout.compat()).lines())
        };

        // The JSON-RPC transport keeps polling stdout while it drains stdin.
        // Signal physical EOF so a child that half-closes stdout and stops
        // reading cannot hold a final write open forever. Dropping this stream
        // merely cancels the signal and is not treated as EOF.
        let (stdout_eof_tx, stdout_eof_rx) = futures::channel::oneshot::channel();
        let mut stdout_eof_tx = Some(stdout_eof_tx);
        let mut incoming_lines = incoming_lines;
        let incoming_lines = Box::pin(futures::stream::poll_fn(move |context| {
            let next = incoming_lines.as_mut().poll_next(context);
            if matches!(next, std::task::Poll::Ready(None))
                && let Some(stdout_eof_tx) = stdout_eof_tx.take()
            {
                let _ = stdout_eof_tx.send(());
            }
            next
        }));

        let outgoing_sink: std::pin::Pin<
            Box<dyn futures::Sink<String, Error = std::io::Error> + Send>,
        > = Box::pin(futures::sink::unfold(
            (
                stdin.compat_write(),
                self.debug_callback.clone(),
                Some(stdout_eof_rx),
                false,
            ),
            async move |(mut writer, callback, mut stdout_eof_rx, mut stdout_eof_seen),
                        line: String| {
                if let Some(callback) = callback.as_ref() {
                    callback(&line, LineDirection::Stdin);
                }
                write_line_with_shutdown_timeout(
                    &mut writer,
                    line,
                    &mut stdout_eof_rx,
                    &mut stdout_eof_seen,
                    SHUTDOWN_GRACE_PERIOD,
                )
                .await?;
                Ok::<_, std::io::Error>((writer, callback, stdout_eof_rx, stdout_eof_seen))
            },
        ));

        let protocol_future =
            ConnectTo::<Client>::connect_to(Lines::new(outgoing_sink, incoming_lines), client);

        let stderr_future = pin!(stderr_future);
        let protocol_future = Box::pin(protocol_future);
        let child_wait = Box::pin(child_wait);

        // Errors stop the connection immediately. After protocol shutdown
        // succeeds, the child gets a bounded grace period so delayed failures
        // remain observable without a non-exiting launcher hanging shutdown.
        let main_race = async {
            match futures::future::select(protocol_future, child_wait).await {
                futures::future::Either::Left((result, child_wait)) => {
                    result?;
                    let grace = pin!(tokio::time::sleep(SHUTDOWN_GRACE_PERIOD));
                    match futures::future::select(child_wait, grace).await {
                        futures::future::Either::Left((child, _)) => {
                            finish_child_exit(child?).await
                        }
                        futures::future::Either::Right((_, child_wait)) => {
                            tracing::debug!(
                                grace = ?SHUTDOWN_GRACE_PERIOD,
                                "agent process did not exit after protocol shutdown; terminating it"
                            );
                            drop(child_wait);
                            Ok(())
                        }
                    }
                }
                futures::future::Either::Right((child, protocol_future)) => {
                    finish_child_exit(child?).await?;
                    await_protocol_shutdown_after_successful_child_exit(
                        protocol_future,
                        SHUTDOWN_GRACE_PERIOD,
                    )
                    .await
                }
            }
        };

        // Once the main race completes, stderr is no longer needed.
        let main_race = pin!(main_race);
        match futures::future::select(main_race, stderr_future).await {
            futures::future::Either::Left((result, _)) => result,
            futures::future::Either::Right(((), main_race)) => main_race.await,
        }
    }
}
