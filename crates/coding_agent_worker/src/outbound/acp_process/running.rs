//! A spawned ACP agent relayed line by line, which on Unix can be handed to
//! the next macrod process image without stopping.
//!
//! [`AcpProcess::connect_to`] drives an agent through the SDK, which owns
//! the reads and writes. The harness bridge instead relays raw lines, and
//! needs what the SDK cannot give it: to stop reading at a line boundary,
//! finish the writes already queued, and take the pipes back.

use std::time::Duration;

use agent_client_protocol::util::internal_error;
use agent_client_protocol::{Error, LineDirection};
use tokio::io::{AsyncBufReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::process::{ChildStderr, ChildStdin, ChildStdout};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_util::compat::TokioAsyncReadCompatExt as _;

use super::{
    AcpProcess, ChildGuard, DebugCallback, SHUTDOWN_GRACE_PERIOD, SpawnedChild, StderrDrainResult,
    drain_stderr,
};

/// An agent process this daemon started (or inherited), not yet relayed.
pub(crate) struct RunningAgent {
    stdin: ChildStdin,
    stdout: ChildStdout,
    stderr: ChildStderr,
    /// Output read past the last relayed line. Always the start of a line.
    pending_output: Vec<u8>,
    guard: ChildGuard,
}

impl AcpProcess {
    /// Spawn the agent for a line relay ([`RunningAgent::attach`]).
    pub(crate) fn start(&self) -> Result<RunningAgent, Error> {
        let SpawnedChild {
            stdin,
            stdout,
            stderr,
            guard,
        } = self.spawn()?;
        Ok(RunningAgent {
            stdin,
            stdout,
            stderr,
            pending_output: Vec::new(),
            guard,
        })
    }
}

impl RunningAgent {
    /// Start relaying: stdout is split into lines, stdin takes lines, and
    /// stderr is drained. `debug` sees every line in every direction.
    pub(crate) fn attach(self, debug: DebugCallback) -> AttachedAgent {
        let Self {
            stdin,
            stdout,
            mut stderr,
            pending_output,
            guard,
        } = self;

        let (lines_tx, lines) = mpsc::unbounded_channel();
        let (stop_reading, reading_stopped) = oneshot::channel();
        let reader = tokio::spawn(read_lines(
            BufReader::new(stdout),
            pending_output,
            lines_tx,
            reading_stopped,
            debug.clone(),
        ));

        let (writes, writes_rx) = mpsc::unbounded_channel();
        let writer = tokio::spawn(write_lines(stdin, writes_rx, debug.clone()));

        let (stop_stderr, stderr_stopped) = oneshot::channel::<()>();
        let stderr_task = tokio::spawn(async move {
            let drained = drain_stderr(&mut (&mut stderr).compat(), Some(debug), async {
                let _ = stderr_stopped.await;
            })
            .await;
            (stderr, drained)
        });

        AttachedAgent {
            lines,
            stop_reading: Some(stop_reading),
            reader,
            writes,
            writer,
            stop_stderr,
            stderr: stderr_task,
            guard,
        }
    }
}

/// What the relayed agent did next.
pub(crate) enum AgentEvent {
    /// An output line, or `None` once its stdout ended.
    Line(Option<String>),
    /// The process exited.
    Exited(std::io::Result<std::process::ExitStatus>),
}

/// An agent whose stdio is being relayed.
pub(crate) struct AttachedAgent {
    lines: mpsc::UnboundedReceiver<String>,
    stop_reading: Option<oneshot::Sender<()>>,
    reader: JoinHandle<std::io::Result<(BufReader<ChildStdout>, Vec<u8>)>>,
    writes: mpsc::UnboundedSender<String>,
    writer: JoinHandle<std::io::Result<ChildStdin>>,
    stop_stderr: oneshot::Sender<()>,
    stderr: JoinHandle<(ChildStderr, StderrDrainResult)>,
    guard: ChildGuard,
}

impl AttachedAgent {
    /// The agent's next output line; `None` once its stdout has ended or
    /// reading was stopped and every line read before is delivered.
    pub(crate) async fn next_line(&mut self) -> Option<String> {
        self.lines.recv().await
    }

    /// Queue a line for the agent's stdin. Lines are written whole and in
    /// order.
    pub(crate) fn send_line(&self, line: String) -> std::io::Result<()> {
        self.writes
            .send(line)
            .map_err(|_| std::io::Error::other("the agent's stdin writer stopped"))
    }

    /// Resolves when the agent process exits. Cancel-safe.
    pub(crate) async fn exited(&mut self) -> std::io::Result<std::process::ExitStatus> {
        self.guard.wait().await
    }

    /// The next output line or the process exit, whichever comes first.
    /// Cancel-safe.
    pub(crate) async fn next_event(&mut self) -> AgentEvent {
        tokio::select! {
            line = self.lines.recv() => AgentEvent::Line(line),
            status = self.guard.wait() => AgentEvent::Exited(status),
        }
    }

    /// Stop reading after the line in progress; [`Self::next_line`] then
    /// returns what was already read, then `None`.
    pub(crate) fn stop_reading(&mut self) {
        if let Some(stop) = self.stop_reading.take() {
            let _ = stop.send(());
        }
    }

    /// End the relay after the agent exited with `status`: the rest of its
    /// process group is killed, and a failure carries the stderr tail.
    pub(crate) async fn finish(self, status: std::process::ExitStatus) -> Result<(), Error> {
        let Self {
            mut guard,
            stderr,
            stop_stderr,
            reader,
            writer,
            ..
        } = self;
        // A launcher may exit while a descendant still holds its stdio.
        guard.terminate();
        reader.abort();
        writer.abort();
        if status.success() {
            stderr.abort();
            return Ok(());
        }
        let captured = match tokio::time::timeout(SHUTDOWN_GRACE_PERIOD, stderr).await {
            Ok(Ok((_, drained))) => drained.captured,
            _ => {
                drop(stop_stderr);
                String::new()
            }
        };
        if captured.is_empty() {
            Err(internal_error(format!("Process exited with {status}")))
        } else {
            Err(internal_error(format!(
                "Process exited with {status}: {captured}"
            )))
        }
    }

    /// Take the agent back from the relay without stopping it: reading has
    /// stopped ([`Self::stop_reading`]) and every line read was taken, the
    /// queued writes are flushed, and what was read past the last line is
    /// kept for whoever relays the agent next.
    #[cfg(unix)]
    pub(crate) async fn detach(self, within: Duration) -> std::io::Result<RunningAgent> {
        let Self {
            lines,
            stop_reading,
            reader,
            writes,
            writer,
            stop_stderr,
            stderr,
            guard,
        } = self;
        debug_assert!(stop_reading.is_none(), "stop reading before detaching");
        drop(lines);
        drop(writes);
        let _ = stop_stderr.send(());
        let detached = async {
            let (stdout, pending_output) = reader.await.map_err(std::io::Error::other)??;
            let stdin = writer.await.map_err(std::io::Error::other)??;
            let (stderr, _) = stderr.await.map_err(std::io::Error::other)?;
            Ok::<_, std::io::Error>(RunningAgent {
                stdin,
                stdout: stdout.into_inner(),
                stderr,
                pending_output,
                guard,
            })
        };
        tokio::time::timeout(within, detached)
            .await
            .map_err(|_| std::io::Error::other("the agent's pipes did not settle in time"))?
    }
}

/// Split stdout into lines until EOF or `stop`. On stop, returns the reader
/// and the bytes read past the last full line, so nothing is lost.
async fn read_lines(
    mut stdout: BufReader<ChildStdout>,
    mut partial: Vec<u8>,
    lines: mpsc::UnboundedSender<String>,
    mut stop: oneshot::Receiver<()>,
    debug: DebugCallback,
) -> std::io::Result<(BufReader<ChildStdout>, Vec<u8>)> {
    // Output handed over by an earlier process image may hold whole lines.
    while let Some(end) = partial.iter().position(|byte| *byte == b'\n') {
        deliver(partial.drain(..=end).collect(), &lines, &debug);
    }
    loop {
        // `partial` survives a cancelled `read_until`: whatever it read stays
        // in it, and the rest stays in the reader's buffer.
        tokio::select! {
            biased;
            _ = &mut stop => {
                let mut unread = partial;
                unread.extend_from_slice(stdout.buffer());
                let buffered = stdout.buffer().len();
                stdout.consume(buffered);
                return Ok((stdout, unread));
            }
            read = stdout.read_until(b'\n', &mut partial) => {
                if read? == 0 {
                    // EOF: an unterminated last line is still a line.
                    if !partial.is_empty() {
                        deliver(std::mem::take(&mut partial), &lines, &debug);
                    }
                    return Ok((stdout, Vec::new()));
                }
                if partial.last() == Some(&b'\n') {
                    deliver(std::mem::take(&mut partial), &lines, &debug);
                }
            }
        }
    }
}

fn deliver(mut line: Vec<u8>, lines: &mpsc::UnboundedSender<String>, debug: &DebugCallback) {
    if line.last() == Some(&b'\n') {
        line.pop();
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    if line.is_empty() {
        return;
    }
    match String::from_utf8(line) {
        Ok(line) => {
            debug(&line, LineDirection::Stdout);
            let _ = lines.send(line);
        }
        Err(error) => tracing::warn!(error = %error, "dropping a non-UTF-8 line from the agent"),
    }
}

/// Write each queued line whole, then hand stdin back once the queue closes.
async fn write_lines(
    mut stdin: ChildStdin,
    mut writes: mpsc::UnboundedReceiver<String>,
    debug: DebugCallback,
) -> std::io::Result<ChildStdin> {
    while let Some(line) = writes.recv().await {
        debug(&line, LineDirection::Stdin);
        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        stdin.write_all(&bytes).await?;
        stdin.flush().await?;
    }
    Ok(stdin)
}

#[cfg(unix)]
mod handoff {
    use std::os::fd::OwnedFd;

    use super::{ChildGuard, RunningAgent};
    use crate::handoff::{HandedOffAgent, HandedOffParts};
    use crate::turns::ActiveTurns;

    impl RunningAgent {
        /// Pick up an agent the previous process image handed over, and the
        /// turns it had running.
        pub(crate) fn adopt(agent: HandedOffAgent, turns: &ActiveTurns) -> std::io::Result<Self> {
            let HandedOffParts {
                pid,
                stdin,
                stdout,
                stderr,
                pending_output,
                active_prompts,
            } = agent.into_parts();
            turns.restore(active_prompts);
            let guard = ChildGuard::adopt(pid);
            Ok(Self {
                stdin: tokio::process::ChildStdin::from_std(std::process::ChildStdin::from(stdin))?,
                stdout: tokio::process::ChildStdout::from_std(std::process::ChildStdout::from(
                    stdout,
                ))?,
                stderr: tokio::process::ChildStderr::from_std(std::process::ChildStderr::from(
                    stderr,
                ))?,
                pending_output,
                guard,
            })
        }

        /// Hand the agent to the next process image. It keeps running; the
        /// guard no longer kills it.
        pub(crate) fn hand_off(
            mut self,
            active_prompts: Vec<String>,
        ) -> std::io::Result<HandedOffAgent> {
            let pid = self
                .guard
                .pid()
                .ok_or_else(|| std::io::Error::other("the agent has no pid"))?;
            let stdin: OwnedFd = self.stdin.into_owned_fd()?;
            let stdout: OwnedFd = self.stdout.into_owned_fd()?;
            let stderr: OwnedFd = self.stderr.into_owned_fd()?;
            self.guard.release();
            Ok(HandedOffAgent::new(
                pid,
                stdin,
                stdout,
                stderr,
                self.pending_output,
                active_prompts,
            ))
        }
    }
}
