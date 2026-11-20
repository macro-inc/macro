//! The host end of a guest agent's hybrid vsock: Firecracker's `CONNECT
//! <port>` handshake on the jail's Unix socket, retried until a deadline,
//! and one exec over the connection.

use std::path::Path;
use std::time::Duration;

use firecracker_host_api::exec::{ExecRequest, Frame, read_frame, write_frame};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::Instant;
use tracing::field::Empty;

use super::GuestLinkError;

#[cfg(test)]
mod test;

/// How long a first handshake may take before it is given up and tried
/// again. Firecracker forwards the `CONNECT` to the guest and gives up on a
/// request the guest leaves unanswered within a couple of seconds, so a
/// handshake still unanswered after this is stuck below the guest agent and
/// a fresh one is the way out. Each timeout doubles the next attempt's
/// limit, so a stall longer than the limit is still waited out.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(3);
/// The pause after a first failed attempt; it doubles up to
/// [`RETRY_DELAY_MAX`]. No attempt is given less than this.
const RETRY_DELAY_MIN: Duration = Duration::from_millis(10);
/// The longest pause between attempts, so a boot is noticed within it.
const RETRY_DELAY_MAX: Duration = Duration::from_millis(100);

/// Connect to `port` through `socket`, retrying until `deadline`: the guest
/// agent starts listening some time into a boot, and the vsock gives no
/// signal. The first attempt gets at most `handshake_timeout`. A failed
/// attempt is routine while a guest boots, so the span keeps only the
/// count and the last error; a handshake that times out warns.
#[tracing::instrument(
    name = "firecracker_host.vsock_connect",
    skip_all,
    fields(port = port, attempts = Empty, last_error = Empty),
    // The callers' spans carry the error too.
    err(level = "warn")
)]
pub async fn connect_until(
    socket: &Path,
    port: u32,
    deadline: Instant,
    handshake_timeout: Duration,
) -> Result<UnixStream, GuestLinkError> {
    let mut attempt: u32 = 0;
    let mut delay = RETRY_DELAY_MIN;
    let mut handshake_limit = handshake_timeout;
    let outcome = loop {
        attempt += 1;
        let limit = handshake_limit
            .min(deadline.saturating_duration_since(Instant::now()))
            .max(RETRY_DELAY_MIN);
        let error = match tokio::time::timeout(limit, handshake(socket, port)).await {
            Ok(Ok(stream)) => break Ok(stream),
            Ok(Err(error)) => error,
            // Cut short by the deadline: the caller's limit, not a stuck
            // handshake.
            Err(_) if limit < handshake_limit => {
                break Err(GuestLinkError::HandshakeTimedOut(limit));
            }
            Err(_) => {
                tracing::warn!(
                    attempt,
                    limit_ms = limit.as_millis(),
                    "vsock handshake got no answer; trying again"
                );
                handshake_limit = handshake_limit.saturating_mul(2);
                GuestLinkError::HandshakeTimedOut(limit)
            }
        };
        // An attempt that could only get less than the shortest limit would
        // report its own timeout instead of what failed all along.
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining < RETRY_DELAY_MIN * 2 {
            break Err(error);
        }
        tracing::debug!(attempt, error = %error, "vsock connect failed; trying again");
        tokio::time::sleep(delay.min(remaining - RETRY_DELAY_MIN)).await;
        delay = (delay * 2).min(RETRY_DELAY_MAX);
    };
    let span = tracing::Span::current();
    span.record("attempts", attempt);
    if let Err(error) = &outcome {
        span.record("last_error", tracing::field::display(error));
    }
    outcome
}

async fn handshake(socket: &Path, port: u32) -> Result<UnixStream, GuestLinkError> {
    let mut stream = match UnixStream::connect(socket).await {
        Ok(stream) => stream,
        Err(source) => {
            return Err(GuestLinkError::Connect {
                socket: socket.to_owned(),
                source,
            });
        }
    };
    stream
        .write_all(format!("CONNECT {port}\n").as_bytes())
        .await
        .map_err(GuestLinkError::Handshake)?;
    // Read the `OK <port>\n` answer byte by byte, so nothing after it is
    // buffered away from the exec frames.
    let mut answer = Vec::new();
    let mut reader = BufReader::with_capacity(1, &mut stream);
    reader
        .read_until(b'\n', &mut answer)
        .await
        .map_err(GuestLinkError::Handshake)?;
    if !answer.starts_with(b"OK ") {
        return Err(GuestLinkError::Refused(
            String::from_utf8_lossy(&answer).into_owned(),
        ));
    }
    Ok(stream)
}

/// `argv` run as root with `path` as its `PATH`, carrying the current trace
/// id: the guest agent exports no traces, so its log lines are found from
/// the host's trace by that id.
pub fn root_request(argv: &[&str], path: &str) -> ExecRequest {
    ExecRequest {
        argv: argv.iter().map(|arg| (*arg).to_owned()).collect(),
        uid: 0,
        gid: 0,
        env: [("PATH".to_owned(), path.to_owned())].into(),
        cwd: "/".to_owned(),
        trace_id: macro_tower_layers::current_trace_id(),
    }
}

/// Run `request` over a connected `stream` with its stdin closed; the
/// program's exit code and stdout, if it ends before `deadline`.
pub async fn exec(
    mut stream: UnixStream,
    request: ExecRequest,
    deadline: Instant,
) -> Result<(i32, Vec<u8>), GuestLinkError> {
    let argv = request.argv.clone();
    write_frame(&mut stream, &Frame::Start(request)).await?;
    write_frame(&mut stream, &Frame::CloseStdin).await?;
    let mut stdout = Vec::new();
    let code = tokio::time::timeout_at(deadline, async {
        loop {
            match read_frame(&mut stream).await {
                Ok(Some(Frame::Stdout(bytes))) => stdout.extend(bytes),
                Ok(Some(Frame::Exited(code))) => return Ok(code),
                Ok(Some(Frame::Failed(message))) => {
                    return Err(GuestLinkError::Failed(message));
                }
                Ok(Some(_)) => {}
                Ok(None) => return Err(GuestLinkError::Closed),
                Err(error) => return Err(error.into()),
            }
        }
    })
    .await
    .map_err(|_| GuestLinkError::TimedOut(argv))??;
    Ok((code, stdout))
}
