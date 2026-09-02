//! Replaying recorded raw SSE through the decode → translate pipeline.
//!
//! A fixture in `fixtures/real/` is the bytes `api.cursor.com` sent, so
//! turning one back into ACP updates runs the same three stages a live run
//! does: [`sse_core`] frames the bytes, [`CursorEvent::from_wire`] names
//! each record, and [`TranslateMachine`] maps it to session updates. Tests
//! that assert on the far end of that therefore cover all three, which
//! fixtures of already-decoded events cannot.
//!
//! [`chunked`] takes the read size because that is the one thing a recording
//! deliberately does not preserve: chunk boundaries are an artifact of one
//! TCP session, so the tests replay each fixture at several sizes and require
//! the results to agree, which pins more than any single recorded split
//! history would.

#[cfg(test)]
mod test;

use crate::api::MAX_SSE_PAYLOAD;
use crate::domain::event::CursorEvent;
use crate::domain::translate::TranslateMachine;
use agent_client_protocol::schema::v1::SessionUpdate;
use sse_core::SseEvent;

/// One decoded record: the SSE event name and its payload.
///
/// `sse_core`'s `MessageEvent` also carries `last_event_id`, which nothing
/// consumes yet — it is what a reconnect would resume from. Reduced to the
/// two fields the translation reads so that comparing two decodings compares
/// what matters.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Record {
    /// The `event:` name, defaulted to `message` by the spec.
    pub event: String,
    /// All `data:` lines, joined with newlines.
    pub data: String,
}

/// Decode a recording, feeding the decoder `chunk_size` bytes at a time.
///
/// Synchronous, because [`sse_core`]'s decoder is: bytes go in, whole
/// records come out, and a record split across chunks stays in the decoder's
/// own buffers until it is complete. That is what lets the sweeps replay one
/// fixture at seven different read sizes and demand identical results.
///
/// `chunk_size` is clamped to at least one byte, so `0` means the pathological
/// byte-at-a-time replay rather than an infinite loop.
///
/// # Panics
/// If a fixture carries a payload past
/// [`MAX_SSE_PAYLOAD`](crate::api::MAX_SSE_PAYLOAD). Fixtures are
/// part of the test suite; one that cannot be decoded should fail loudly.
#[must_use]
pub fn chunked(sse: &str, chunk_size: usize) -> Vec<Record> {
    let mut decoder = sse_core::SseDecoder::with_limit(MAX_SSE_PAYLOAD);
    let mut records = Vec::new();
    for chunk in sse.as_bytes().chunks(chunk_size.max(1)) {
        let mut cursor: &[u8] = chunk;
        while let Some(event) = decoder.next(&mut cursor) {
            match event.expect("fixture payload within the limit") {
                SseEvent::Message(message) => records.push(Record {
                    event: message.event.into_owned(),
                    data: message.data,
                }),
                // Cursor has never sent one; nothing reconnects on it yet.
                SseEvent::Retry(_) => {}
            }
        }
    }
    records
}

/// Decode a recording in one push — the whole-file read.
#[must_use]
pub fn records(sse: &str) -> Vec<Record> {
    chunked(sse, sse.len().max(1))
}

/// Decode a recording into the domain's event vocabulary.
///
/// Mirrors what [`crate::api::CursorClient`]'s stream does per record: a
/// payload that is not JSON becomes `Null`, which `from_wire` then reports as
/// [`CursorEvent::Unknown`] rather than failing the stream.
#[must_use]
pub fn events(sse: &str) -> Vec<CursorEvent> {
    records(sse)
        .into_iter()
        .map(|record| {
            let data = serde_json::from_str(&record.data).unwrap_or(serde_json::Value::Null);
            CursorEvent::from_wire(&record.event, data)
        })
        .collect()
}

/// Replay a recording all the way to the ACP updates a client would receive.
#[must_use]
pub fn updates(sse: &str) -> Vec<SessionUpdate> {
    let mut machine = TranslateMachine::new();
    events(sse)
        .into_iter()
        .flat_map(|event| machine.push(event))
        .collect()
}
