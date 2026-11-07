//! Binary WebSocket frame encoding and per-connection reassembly.

/// A malformed WebSocket frame.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum FramingError {
    /// A frame must contain at least its final-chunk header.
    #[error("received empty websocket frame")]
    EmptyFrame,
}

type Result<T> = std::result::Result<T, FramingError>;

/// Max bytes of message payload per frame. Kept under the durable object's ~1 MB
/// outbound websocket limit (and the server's inbound `MAX_MESSAGE_SIZE`),
/// leaving headroom for the 1-byte frame header and websocket overhead.
pub const MAX_CHUNK_SIZE: usize = 900_000;

/// Splits a serialized message into wire frames of `[is_final: u8][chunk bytes]`.
///
/// `is_final` is 1 on the last (or only) frame, 0 otherwise. Always yields at
/// least one frame, so an empty payload produces a single final empty frame.
/// The receiver concatenates chunk bodies until it sees a nonzero final flag.
pub fn into_frames(payload: &[u8], max_chunk: usize) -> Vec<Vec<u8>> {
    let mut chunks = payload.chunks(max_chunk).peekable();

    // `chunks` is empty only when `payload` is empty; emit one empty final frame.
    if chunks.peek().is_none() {
        return vec![vec![1]];
    }

    let mut frames = Vec::new();
    while let Some(chunk) = chunks.next() {
        let is_final = chunks.peek().is_none();
        let mut frame = Vec::with_capacity(1 + chunk.len());
        frame.push(u8::from(is_final));
        frame.extend_from_slice(chunk);
        frames.push(frame);
    }
    frames
}

/// Splits a received frame into its `is_final` flag and payload slice.
pub fn strip_frame(frame: &[u8]) -> Result<(bool, &[u8])> {
    let (&header, payload) = frame.split_first().ok_or(FramingError::EmptyFrame)?;
    Ok((header != 0, payload))
}

/// Reassembles inbound frames (produced by [`into_frames`]) back into whole
/// messages. One per connection; frames arrive in order over a single socket.
///
/// Held in memory, so a partial mid-message is lost if the durable object
/// hibernates between frames — acceptable because clients only ever send small,
/// single-frame messages (a dropped partial just fails to deserialize and the
/// client resends).
#[derive(Default)]
pub struct Reassembler {
    buffer: Vec<u8>,
}

impl Reassembler {
    /// Feeds one frame. Returns the complete message once the final frame
    /// arrives, otherwise `None` (more frames pending).
    pub fn push(&mut self, frame: &[u8]) -> Result<Option<Vec<u8>>> {
        let (is_final, payload) = strip_frame(frame)?;
        self.buffer.extend_from_slice(payload);
        if is_final {
            Ok(Some(std::mem::take(&mut self.buffer)))
        } else {
            Ok(None)
        }
    }
}

#[cfg(test)]
mod test;
