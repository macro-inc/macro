//! `harnessd` without a subcommand: request lines from stdin go to the
//! daemon's socket and its answer lines to stdout.

use harnessd_protocol::{ErrorKind, Request, Response};
use std::path::Path;
use tokio::io::{AsyncBufRead, AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::net::UnixStream;

#[cfg(test)]
mod test;

/// How a client run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientOutcome {
    /// The daemon answered every request.
    Answered,
    /// No daemon listens; every request was answered `unavailable`.
    Unavailable,
}

/// Forward `input` to the daemon at `socket` and its answers to `output`,
/// until `input` ends and every answer arrived.
pub async fn run<Input, Output>(
    socket: &Path,
    input: Input,
    mut output: Output,
) -> std::io::Result<ClientOutcome>
where
    Input: AsyncBufRead + AsyncRead + Unpin,
    Output: AsyncWrite + Unpin,
{
    let stream = match UnixStream::connect(socket).await {
        Ok(stream) => stream,
        Err(error) => {
            tracing::warn!(%error, socket = %socket.display(), "harnessd is not running");
            answer_unavailable(input, output).await?;
            return Ok(ClientOutcome::Unavailable);
        }
    };

    let (mut socket_reader, mut socket_writer) = stream.into_split();
    let mut input = input;
    let send = async {
        tokio::io::copy(&mut input, &mut socket_writer).await?;
        // The daemon answers what it has read, then hangs up.
        socket_writer.shutdown().await
    };
    let receive = async {
        tokio::io::copy(&mut socket_reader, &mut output).await?;
        output.flush().await
    };
    tokio::try_join!(send, receive)?;
    Ok(ClientOutcome::Answered)
}

async fn answer_unavailable<Input, Output>(input: Input, mut output: Output) -> std::io::Result<()>
where
    Input: AsyncBufRead + Unpin,
    Output: AsyncWrite + Unpin,
{
    let mut lines = input.lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let agent = serde_json::from_str::<Request>(&line)
            .ok()
            .map(|request| request.agent());
        let response = Response::Error {
            agent,
            kind: ErrorKind::Unavailable,
        };
        let mut answer_line = serde_json::to_string(&response).map_err(std::io::Error::other)?;
        answer_line.push('\n');
        output.write_all(answer_line.as_bytes()).await?;
    }
    output.flush().await
}
