//! A guest program run through `POST /1.0/instances/{name}/exec` with its
//! stdio attached: Incus hands out one websocket secret per stream (`0`, `1`,
//! `2`) plus `control`, and starts the program once all four are connected.
//! Each stream is pumped between its websocket and an in-process pipe; the
//! operation's `return` metadata is the exit code.

use std::collections::BTreeMap;
use std::pin::Pin;

use futures::{SinkExt, StreamExt};
use tokio::io::{AsyncReadExt, AsyncWriteExt, DuplexStream};
use tokio::net::TcpStream;
use tokio::sync::oneshot;
use tokio::task::{AbortHandle, JoinHandle};
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream};

use crate::IncusError;
use crate::generated::types;

/// How much each stdio pipe buffers before its writer waits.
const PIPE_BYTES: usize = 64 * 1024;

/// What Incus's control websocket takes to deliver SIGKILL.
const KILL_MESSAGE: &str = r#"{"command":"signal","signal":9}"#;

pub(crate) type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// A program to run through [`crate::IncusClient::exec_attached`], without a TTY.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecCommand {
    /// The program and its arguments.
    pub command: Vec<String>,
    /// The program's whole environment besides what Incus adds.
    pub environment: BTreeMap<String, String>,
    /// User id the program runs as.
    pub user: u32,
    /// Group id the program runs as.
    pub group: u32,
    /// Working directory.
    pub cwd: String,
}

/// A running guest program. Read `stdout` and `stderr` while awaiting `exit`:
/// a full pipe holds the program back. Dropping `exit` before it resolves
/// sends the program SIGKILL.
pub struct AttachedExec {
    /// The program's stdin; shutting it down closes the program's stdin.
    pub stdin: DuplexStream,
    /// The program's stdout.
    pub stdout: DuplexStream,
    /// The program's stderr.
    pub stderr: DuplexStream,
    /// The exit code, once the program ended and stdout and stderr were
    /// pumped to their pipes.
    pub exit: Pin<Box<dyn Future<Output = Result<i64, IncusError>> + Send>>,
}

impl std::fmt::Debug for AttachedExec {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("AttachedExec")
            .finish_non_exhaustive()
    }
}

/// The websocket secrets of one exec operation.
#[derive(Debug, PartialEq, Eq)]
pub(crate) struct ExecSecrets {
    pub(crate) stdin: String,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) control: String,
}

/// The `metadata.fds` secrets of a started exec operation.
pub(crate) fn exec_secrets(operation: &types::Operation) -> Result<ExecSecrets, IncusError> {
    let fds = operation
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.get("fds"))
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| IncusError::MalformedResponse("missing exec fds".to_owned()))?;

    let secret = |key: &str, stream: &str| {
        fds.get(key)
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| IncusError::MalformedResponse(format!("missing exec {stream} secret")))
    };

    Ok(ExecSecrets {
        stdin: secret("0", "stdin")?,
        stdout: secret("1", "stdout")?,
        stderr: secret("2", "stderr")?,
        control: secret("control", "control")?,
    })
}

/// `wss://…/1.0/operations/{id}/websocket?secret=…` for an `https://` API
/// base (`ws://` for `http://`).
pub(crate) fn operation_websocket_url(
    base: &str,
    operation_id: &str,
    secret: &str,
) -> Result<String, IncusError> {
    let base = base.trim_end_matches('/');
    let websocket_base = if let Some(host) = base.strip_prefix("https://") {
        format!("wss://{host}")
    } else if let Some(host) = base.strip_prefix("http://") {
        format!("ws://{host}")
    } else {
        return Err(IncusError::MalformedResponse(format!(
            "Incus URL {base:?} is neither https nor http"
        )));
    };

    Ok(format!(
        "{websocket_base}/1.0/operations/{operation_id}/websocket?secret={secret}"
    ))
}

/// The four connected websockets of one exec operation.
pub(crate) struct ExecSockets {
    pub(crate) stdin: Socket,
    pub(crate) stdout: Socket,
    pub(crate) stderr: Socket,
    pub(crate) control: Socket,
}

/// Pump the sockets to pipes; `exit` waits for the operation, then for
/// stdout and stderr to reach their pipes.
pub(crate) fn attach(
    sockets: ExecSockets,
    operation: impl Future<Output = Result<i64, IncusError>> + Send + 'static,
) -> AttachedExec {
    let (stdin, stdin_source) = tokio::io::duplex(PIPE_BYTES);
    let (stdout_sink, stdout) = tokio::io::duplex(PIPE_BYTES);
    let (stderr_sink, stderr) = tokio::io::duplex(PIPE_BYTES);
    let (kill, killed) = oneshot::channel();

    let stdin_pump = tokio::spawn(pump_stdin(stdin_source, sockets.stdin));
    let stdout_pump = tokio::spawn(pump_output(sockets.stdout, stdout_sink));
    let stderr_pump = tokio::spawn(pump_output(sockets.stderr, stderr_sink));
    tokio::spawn(hold_control(sockets.control, killed));

    let mut guard = KillOnDrop {
        kill: Some(kill),
        pumps: [
            stdin_pump.abort_handle(),
            stdout_pump.abort_handle(),
            stderr_pump.abort_handle(),
        ],
    };
    let exit = async move {
        let exit_code = operation.await?;
        drained(stdout_pump, "stdout").await?;
        drained(stderr_pump, "stderr").await?;
        guard.disarm();
        Ok(exit_code)
    };

    AttachedExec {
        stdin,
        stdout,
        stderr,
        exit: Box::pin(exit),
    }
}

async fn drained(pump: JoinHandle<()>, stream: &str) -> Result<(), IncusError> {
    pump.await
        .map_err(|error| IncusError::WebSocket(format!("{stream} pump stopped: {error}")))
}

/// Sends SIGKILL and stops the pumps unless the program's exit was observed.
struct KillOnDrop {
    kill: Option<oneshot::Sender<()>>,
    pumps: [AbortHandle; 3],
}

impl KillOnDrop {
    /// The program ended; dropping the sender closes the control socket.
    fn disarm(&mut self) {
        self.kill = None;
    }
}

impl Drop for KillOnDrop {
    fn drop(&mut self) {
        let Some(kill) = self.kill.take() else {
            return;
        };

        // The control task outlives the pumps to deliver the signal.
        if kill.send(()).is_err() {
            tracing::debug!("exec control socket closed before the kill");
        }
        for pump in &self.pumps {
            pump.abort();
        }
    }
}

/// Binary frames for stdin; its end is a close frame, which Incus turns into
/// the program's end of stdin.
async fn pump_stdin(mut stdin: DuplexStream, mut socket: Socket) {
    let mut buffer = vec![0_u8; PIPE_BYTES];
    loop {
        let read = match stdin.read(&mut buffer).await {
            Ok(0) | Err(_) => break,
            Ok(read) => read,
        };

        let frame = Message::binary(buffer[..read].to_vec());
        if let Err(error) = socket.send(frame).await {
            tracing::debug!(%error, "exec stdin websocket broke");
            return;
        }
    }

    if let Err(error) = socket.close(None).await {
        tracing::debug!(%error, "exec stdin websocket did not close cleanly");
    }
}

/// Binary frames into `output` until Incus ends the stream with a close
/// frame (or, from older servers, a text barrier).
async fn pump_output(mut socket: Socket, mut output: DuplexStream) {
    while let Some(message) = socket.next().await {
        let bytes = match message {
            Ok(Message::Binary(bytes)) => bytes,
            Ok(Message::Ping(_) | Message::Pong(_) | Message::Frame(_)) => continue,
            Ok(Message::Text(_) | Message::Close(_)) => break,
            Err(error) => {
                tracing::debug!(%error, "exec output websocket broke");
                break;
            }
        };

        if output.write_all(&bytes).await.is_err() {
            // The reader went away; the program's output has nowhere to go.
            break;
        }
    }

    if let Err(error) = output.shutdown().await {
        tracing::debug!(%error, "exec output pipe did not shut down");
    }
}

/// Hold the control socket open while the program runs, and use it to kill
/// the program when the caller gives up on it.
async fn hold_control(socket: Socket, killed: oneshot::Receiver<()>) {
    let (mut sink, mut stream) = socket.split();
    let reading = async { while let Some(Ok(_)) = stream.next().await {} };

    tokio::select! {
        kill = killed => {
            if kill.is_ok()
                && let Err(error) = sink.send(Message::text(KILL_MESSAGE)).await
            {
                tracing::debug!(%error, "could not send the exec kill signal");
            }
            if let Err(error) = sink.close().await {
                tracing::debug!(%error, "exec control websocket did not close cleanly");
            }
        }
        () = reading => {}
    }
}
