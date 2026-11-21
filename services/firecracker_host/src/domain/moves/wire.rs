//! The peer protocol's framing: one JSON line each way, bounded.

use firecracker_host_api::moves::PeerAnswer;
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};

use super::MAX_PEER_LINE_BYTES;
use crate::domain::service::HostError;

pub(super) fn io_error(error: std::io::Error) -> HostError {
    HostError::Internal(rootcause::Report::new(error).into_dynamic())
}

pub(super) fn peer_refused(answer: PeerAnswer) -> HostError {
    match answer {
        PeerAnswer::Refused { message } => {
            HostError::Internal(rootcause::report!("the target refused: {message}").into_dynamic())
        }
        answer => HostError::Internal(
            rootcause::report!("unexpected answer from the target: {answer:?}").into_dynamic(),
        ),
    }
}

/// Write `value` as one JSON line.
pub(super) async fn write_line(
    writer: &mut (impl AsyncWrite + Unpin + Send),
    value: &impl serde::Serialize,
) -> Result<(), HostError> {
    let mut line = serde_json::to_vec(value)
        .map_err(|error| HostError::Internal(rootcause::Report::new(error).into_dynamic()))?;
    line.push(b'\n');
    writer.write_all(&line).await.map_err(io_error)?;
    writer.flush().await.map_err(io_error)
}

/// Read one JSON line of at most [`MAX_PEER_LINE_BYTES`].
pub(super) async fn read_line<Value: serde::de::DeserializeOwned>(
    reader: &mut (impl AsyncBufReadExt + Unpin + Send),
) -> Result<Value, HostError> {
    use tokio::io::AsyncReadExt;

    let mut line = Vec::new();
    let read = reader
        .take(MAX_PEER_LINE_BYTES as u64)
        .read_until(b'\n', &mut line)
        .await
        .map_err(io_error)?;
    if read == 0 || line.last() != Some(&b'\n') {
        return Err(HostError::MoveRefused(
            "the move request line is missing or too long".to_owned(),
        ));
    }
    serde_json::from_slice(&line).map_err(|error| HostError::MoveRefused(error.to_string()))
}

pub(super) async fn read_answer(
    connection: &mut (impl AsyncRead + Unpin + Send),
) -> Result<PeerAnswer, HostError> {
    read_line(&mut BufReader::new(connection)).await
}
