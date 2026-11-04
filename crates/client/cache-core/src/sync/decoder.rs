//! Push-based NDJSON line splitting: bytes in, complete lines out.

use super::SyncStreamError;

/// Longest accepted line. A Soup page of 500 full rows stays far below it.
pub const MAX_SYNC_LINE_BYTES: usize = 64 * 1024 * 1024;

/// Splits a byte stream into newline-terminated lines across chunk boundaries.
#[derive(Debug, Default)]
pub struct NdjsonDecoder {
    buffer: Vec<u8>,
    /// Bytes of `buffer` already known to contain no newline.
    scanned: usize,
}

impl NdjsonDecoder {
    /// Appends `bytes` and returns every line it completes, without the
    /// newline (`\n`, optionally preceded by `\r`). Blank lines are skipped.
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Vec<u8>>, SyncStreamError> {
        self.buffer.extend_from_slice(bytes);
        let mut lines = Vec::new();
        let mut start = 0;
        let mut search = self.scanned;
        while let Some(offset) = self.buffer[search..].iter().position(|byte| *byte == b'\n') {
            let end = search + offset;
            let mut line = &self.buffer[start..end];
            if let Some(stripped) = line.strip_suffix(b"\r") {
                line = stripped;
            }
            if !line.iter().all(u8::is_ascii_whitespace) {
                lines.push(line.to_vec());
            }
            start = end + 1;
            search = start;
        }
        self.buffer.drain(..start);
        self.scanned = self.buffer.len();
        if self.buffer.len() > MAX_SYNC_LINE_BYTES {
            return Err(SyncStreamError::Stream(format!(
                "a line exceeds {MAX_SYNC_LINE_BYTES} bytes"
            )));
        }
        Ok(lines)
    }

    /// Fails when the stream ended inside a line.
    pub fn finish(&self) -> Result<(), SyncStreamError> {
        if self.buffer.iter().all(u8::is_ascii_whitespace) {
            Ok(())
        } else {
            Err(SyncStreamError::Stream(
                "stream ended inside a line".to_owned(),
            ))
        }
    }
}
