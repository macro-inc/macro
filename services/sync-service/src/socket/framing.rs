use worker::{Error, Result};

/// Max bytes of message payload per frame. Kept under the durable object's ~1 MB
/// outbound websocket limit (and the server's inbound `MAX_MESSAGE_SIZE`),
/// leaving headroom for the 1-byte frame header and websocket overhead.
pub(crate) const MAX_CHUNK_SIZE: usize = 900_000;

/// Splits a serialized message into wire frames of `[is_final: u8][chunk bytes]`.
///
/// `is_final` is 1 on the last (or only) frame, 0 otherwise. Always yields at
/// least one frame, so an empty payload produces a single final empty frame.
/// The receiver concatenates chunk bodies until it sees `is_final == 1`.
pub(crate) fn into_frames(payload: &[u8], max_chunk: usize) -> Vec<Vec<u8>> {
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
pub(crate) fn strip_frame(frame: &[u8]) -> Result<(bool, &[u8])> {
    let (&header, payload) = frame
        .split_first()
        .ok_or_else(|| Error::from("received empty websocket frame"))?;
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
pub(crate) struct Reassembler {
    buffer: Vec<u8>,
}

impl Reassembler {
    /// Feeds one frame. Returns the complete message once the final frame
    /// arrives, otherwise `None` (more frames pending).
    pub(crate) fn push(&mut self, frame: &[u8]) -> Result<Option<Vec<u8>>> {
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
mod tests {
    use super::*;

    #[test]
    fn single_frame_small_payload() {
        let payload = b"hello";
        let frames = into_frames(payload, MAX_CHUNK_SIZE);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0][0], 1);
        assert_eq!(&frames[0][1..], payload);
    }

    #[test]
    fn exact_boundary_is_one_frame() {
        let payload = vec![7u8; 4];
        let frames = into_frames(&payload, 4);
        assert_eq!(frames.len(), 1);
        assert_eq!(frames[0][0], 1);
        assert_eq!(&frames[0][1..], payload.as_slice());
    }

    #[test]
    fn multi_frame_splits_and_flags() {
        let payload: Vec<u8> = (0..10).collect();
        let frames = into_frames(&payload, 4); // 4 + 4 + 2 => 3 frames
        assert_eq!(frames.len(), 3);
        assert_eq!(frames[0][0], 0);
        assert_eq!(frames[1][0], 0);
        assert_eq!(frames[2][0], 1);

        let reassembled: Vec<u8> = frames.iter().flat_map(|f| f[1..].iter().copied()).collect();
        assert_eq!(reassembled, payload);
    }

    #[test]
    fn empty_payload_yields_one_final_frame() {
        assert_eq!(into_frames(&[], 4), vec![vec![1u8]]);
    }

    #[test]
    fn strip_frame_reads_header() {
        assert_eq!(strip_frame(&[1, 2, 3]).unwrap(), (true, &[2, 3][..]));
        assert_eq!(strip_frame(&[0, 9]).unwrap(), (false, &[9][..]));
        assert!(strip_frame(&[]).is_err());
    }

    #[test]
    fn round_trip() {
        let payload: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
        let frames = into_frames(&payload, 64);

        let mut out = Vec::new();
        for frame in &frames {
            let (_is_final, body) = strip_frame(frame).unwrap();
            out.extend_from_slice(body);
        }
        assert_eq!(out, payload);
    }

    #[test]
    fn reassembler_single_final_frame() {
        let mut r = Reassembler::default();
        assert_eq!(r.push(&[1, 9, 8, 7]).unwrap(), Some(vec![9, 8, 7]));
    }

    #[test]
    fn reassembler_returns_none_until_final() {
        let mut r = Reassembler::default();
        assert_eq!(r.push(&[0, 1, 2]).unwrap(), None);
        assert_eq!(r.push(&[0, 3]).unwrap(), None);
        assert_eq!(r.push(&[1, 4, 5]).unwrap(), Some(vec![1, 2, 3, 4, 5]));
    }

    #[test]
    fn reassembler_round_trips_with_into_frames() {
        let payload: Vec<u8> = (0..1000u32).map(|i| i as u8).collect();
        let mut r = Reassembler::default();
        let mut out = None;
        for frame in into_frames(&payload, 64) {
            out = r.push(&frame).unwrap();
        }
        assert_eq!(out, Some(payload));
    }
}
