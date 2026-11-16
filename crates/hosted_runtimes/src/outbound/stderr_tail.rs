//! The end of a guest program's stderr, kept for a debug log on failure.

use tokio::io::{AsyncRead, AsyncReadExt};

use crate::domain::ids::ComputerId;

#[cfg(test)]
mod test;

/// How much of a guest program's stderr is kept.
pub(crate) const STDERR_TAIL_BYTES: usize = 4096;

/// Read `stderr` to its end, keeping only its last `limit` bytes. A read
/// error ends it early with what was read.
pub(crate) async fn read_tail(mut stderr: impl AsyncRead + Unpin, limit: usize) -> Vec<u8> {
    let mut tail = Vec::with_capacity(limit);
    let mut chunk = [0_u8; 1024];
    loop {
        match stderr.read(&mut chunk).await {
            Ok(0) | Err(_) => return tail,
            Ok(read) => {
                tail.extend_from_slice(&chunk[..read]);
                if tail.len() > limit {
                    tail.drain(..tail.len() - limit);
                }
            }
        }
    }
}

/// Log a failed guest program's stderr tail at debug.
pub(crate) fn log_failure(computer_id: ComputerId, exit_code: i32, tail: &[u8]) {
    if exit_code != 0 {
        tracing::debug!(
            %computer_id,
            exit_code,
            stderr = %String::from_utf8_lossy(tail),
            "guest program exited unsuccessfully"
        );
    }
}
