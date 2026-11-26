//! Running a program in a guest, without a TTY.
//!
//! The same [`Frame`]s travel on both legs:
//!
//! - control plane ↔ agent: a WebSocket on `GET /v1/computers/{computer_id}/exec`; each
//!   binary message is one encoded frame.
//! - agent ↔ guest: a vsock stream to [`GUEST_AGENT_PORT`], where the guest
//!   agent (`services/firecracker_guest_agent`) listens as root; each frame is
//!   preceded by its length as a big-endian `u32` ([`write_frame`],
//!   [`read_frame`]). Through Firecracker's hybrid vsock, the agent first
//!   writes `CONNECT 1024\n` on the VM's vsock socket and reads `OK <port>\n`.
//!
//! The caller sends [`Frame::Start`] first, then any [`Frame::Stdin`] and one
//! [`Frame::CloseStdin`]. The other side answers [`Frame::Stdout`] and
//! [`Frame::Stderr`] as the program writes, and ends with exactly one
//! [`Frame::Exited`] (after stdout and stderr are drained) or
//! [`Frame::Failed`] (the program never started, or the guest went away).
//! Closing the connection early kills the program.
//!
//! The host agent puts its trace id in the [`ExecRequest`] it passes on, so
//! the guest agent's log of an exec is found from the agent's trace.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// The vsock port the guest agent listens on.
pub const GUEST_AGENT_PORT: u32 = 1024;

/// Largest encoded frame either side accepts.
pub const MAX_FRAME_BYTES: u32 = 1024 * 1024;

/// What to run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecRequest {
    /// Program and arguments; the program is looked up in `env`'s `PATH`.
    pub argv: Vec<String>,
    /// User id to run as (0 for root).
    pub uid: u32,
    /// Group id to run as.
    pub gid: u32,
    /// The whole environment; nothing is inherited from the guest agent.
    pub env: BTreeMap<String, String>,
    /// Working directory.
    pub cwd: String,
    /// The host agent's trace id (W3C hex), for the guest agent to record:
    /// the guest exports no traces of its own. The host agent always
    /// replaces what a client sends (with `None` outside a trace); a client
    /// joins the trace through the exec request's `traceparent` header.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
}

/// One message of the exec protocol.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    /// Caller → program: what to run. First and only once.
    Start(ExecRequest),
    /// Caller → program: bytes for stdin.
    Stdin(Vec<u8>),
    /// Caller → program: stdin is at its end.
    CloseStdin,
    /// Program → caller: bytes the program wrote to stdout.
    Stdout(Vec<u8>),
    /// Program → caller: bytes the program wrote to stderr.
    Stderr(Vec<u8>),
    /// Program → caller: the exit code (128 + signal when killed). Last.
    Exited(i32),
    /// Program → caller: the program could not run or was lost. Last.
    Failed(String),
}

/// A frame that does not decode.
#[derive(Debug, thiserror::Error)]
pub enum FrameError {
    /// Empty frame: no kind byte.
    #[error("empty exec frame")]
    Empty,
    /// The kind byte is not one this protocol has.
    #[error("unknown exec frame kind {0}")]
    UnknownKind(u8),
    /// The payload does not fit its kind.
    #[error("malformed exec frame payload: {0}")]
    Payload(String),
    /// Bigger than [`MAX_FRAME_BYTES`].
    #[error("exec frame of {0} bytes is over the limit")]
    TooLarge(u32),
    /// The stream failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

const START: u8 = 0;
const STDIN: u8 = 1;
const CLOSE_STDIN: u8 = 2;
const STDOUT: u8 = 3;
const STDERR: u8 = 4;
const EXITED: u8 = 5;
const FAILED: u8 = 6;

impl Frame {
    /// The kind byte followed by the payload.
    pub fn encode(&self) -> Result<Vec<u8>, FrameError> {
        let (kind, payload) = match self {
            Self::Start(request) => (
                START,
                serde_json::to_vec(request)
                    .map_err(|error| FrameError::Payload(error.to_string()))?,
            ),
            Self::Stdin(bytes) => (STDIN, bytes.clone()),
            Self::CloseStdin => (CLOSE_STDIN, Vec::new()),
            Self::Stdout(bytes) => (STDOUT, bytes.clone()),
            Self::Stderr(bytes) => (STDERR, bytes.clone()),
            Self::Exited(code) => (EXITED, code.to_be_bytes().to_vec()),
            Self::Failed(message) => (FAILED, message.as_bytes().to_vec()),
        };
        let mut encoded = Vec::with_capacity(1 + payload.len());
        encoded.push(kind);
        encoded.extend_from_slice(&payload);
        Ok(encoded)
    }

    /// Parse what [`Frame::encode`] wrote.
    pub fn decode(encoded: &[u8]) -> Result<Self, FrameError> {
        let (&kind, payload) = encoded.split_first().ok_or(FrameError::Empty)?;
        match kind {
            START => serde_json::from_slice(payload)
                .map(Self::Start)
                .map_err(|error| FrameError::Payload(error.to_string())),
            STDIN => Ok(Self::Stdin(payload.to_vec())),
            CLOSE_STDIN => Ok(Self::CloseStdin),
            STDOUT => Ok(Self::Stdout(payload.to_vec())),
            STDERR => Ok(Self::Stderr(payload.to_vec())),
            EXITED => <[u8; 4]>::try_from(payload)
                .map(|bytes| Self::Exited(i32::from_be_bytes(bytes)))
                .map_err(|_| FrameError::Payload(format!("exit code of {} bytes", payload.len()))),
            FAILED => Ok(Self::Failed(String::from_utf8_lossy(payload).into_owned())),
            other => Err(FrameError::UnknownKind(other)),
        }
    }
}

/// Write one length-prefixed frame (the vsock leg).
pub async fn write_frame(
    stream: &mut (impl AsyncWrite + Unpin),
    frame: &Frame,
) -> Result<(), FrameError> {
    let encoded = frame.encode()?;
    let length = u32::try_from(encoded.len()).map_err(|_| FrameError::TooLarge(u32::MAX))?;
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(length));
    }
    stream.write_all(&length.to_be_bytes()).await?;
    stream.write_all(&encoded).await?;
    stream.flush().await?;
    Ok(())
}

/// Read one length-prefixed frame; `None` at a clean end of stream.
pub async fn read_frame(
    stream: &mut (impl AsyncRead + Unpin),
) -> Result<Option<Frame>, FrameError> {
    let mut length = [0u8; 4];
    match stream.read_exact(&mut length).await {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.into()),
    }
    let length = u32::from_be_bytes(length);
    if length > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge(length));
    }
    let mut encoded = vec![0u8; length as usize];
    stream.read_exact(&mut encoded).await?;
    Frame::decode(&encoded).map(Some)
}

#[cfg(test)]
mod test;
