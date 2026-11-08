//! Gemini streams send `usageMetadata` on every chunk, and only the last one,
//! the chunk with a `finishReason`, carries `cachedContentTokenCount` and the
//! final output count. Rig records each chunk's usage onto the same `chat`
//! span. OpenTelemetry keeps every write of an attribute and readers take the
//! first, so the span showed the first chunk's counts: no cache reads and no
//! output. Removing usage from the interim chunks leaves rig one write, the
//! final one. Metering decodes the provider's bytes, not these.

use bytes::{Bytes, BytesMut};
use futures::StreamExt;
use rig_core::http_client::sse::BoxedStream;
use serde_json::Value;

use super::MAX_EVENT_BYTES;

#[cfg(test)]
mod test;

/// `body` with usage removed from Gemini's interim chunks.
pub(super) fn without_interim_usage(mut body: BoxedStream) -> BoxedStream {
    Box::pin(async_stream::stream! {
        let mut filter = InterimUsageFilter::default();
        while let Some(chunk) = body.next().await {
            match chunk {
                Ok(bytes) => {
                    let bytes = filter.push(&bytes);
                    if !bytes.is_empty() {
                        yield Ok(bytes);
                    }
                }
                Err(error) => {
                    let rest = filter.finish();
                    if !rest.is_empty() {
                        yield Ok(rest);
                    }
                    yield Err(error);
                    return;
                }
            }
        }
        let rest = filter.finish();
        if !rest.is_empty() {
            yield Ok(rest);
        }
    })
}

/// Rewrites a Gemini SSE body as it streams, one complete event at a time.
#[derive(Default)]
struct InterimUsageFilter {
    /// Bytes of the event still being received.
    pending: BytesMut,
    /// Where the current line of `pending` starts.
    line_start: usize,
    /// How far `pending` has been searched for the end of the event.
    scanned: usize,
    /// An event outgrew [`MAX_EVENT_BYTES`]; the rest passes through as sent.
    passthrough: bool,
    /// The provider sent its final chunk.
    finished: bool,
    /// The last usage removed, replayed if the final chunk never comes.
    removed: Option<Value>,
}

impl InterimUsageFilter {
    /// The complete events in `pending` plus `bytes`, rewritten; an event
    /// still being received waits for the next chunk.
    fn push(&mut self, bytes: &[u8]) -> Bytes {
        if self.passthrough {
            return Bytes::copy_from_slice(bytes);
        }
        self.pending.extend_from_slice(bytes);
        let mut out = BytesMut::new();
        while let Some(event) = self.next_event() {
            match self.rewrite(&event) {
                Some(rewritten) => out.extend_from_slice(&rewritten),
                None => out.extend_from_slice(&event),
            }
        }
        if self.pending.len() > MAX_EVENT_BYTES {
            self.passthrough = true;
            // The final chunk now passes unread; replaying interim usage
            // after it would undo it.
            self.removed = None;
            out.extend_from_slice(&self.pending.split());
        }
        out.freeze()
    }

    /// Whatever is left when the body ends, unchanged. A stream that ended
    /// before its final chunk gets the last usage it carried back, as an
    /// event of its own, so rig still reports the prompt it sent.
    fn finish(&mut self) -> Bytes {
        let mut rest = self.pending.split();
        if rest.is_empty()
            && !self.finished
            && let Some(usage) = self.removed.take()
        {
            let event = serde_json::json!({ "usageMetadata": usage });
            rest.extend_from_slice(format!("data: {event}\r\n\r\n").as_bytes());
        }
        rest.freeze()
    }

    /// The first complete event in `pending`, up to and including the blank
    /// line that ends it.
    fn next_event(&mut self) -> Option<BytesMut> {
        loop {
            let Some(offset) = self
                .pending
                .get(self.scanned..)?
                .iter()
                .position(|byte| *byte == b'\n')
            else {
                // Searched to the end: the next chunk resumes from here.
                self.scanned = self.pending.len();
                return None;
            };
            let newline = self.scanned + offset;
            let line = self.pending.get(self.line_start..newline)?;
            let blank = line.is_empty() || line == b"\r";
            self.scanned = newline + 1;
            self.line_start = self.scanned;
            if blank {
                let event = self.pending.split_to(self.scanned);
                self.scanned = 0;
                self.line_start = 0;
                return Some(event);
            }
        }
    }

    /// The event without `usageMetadata` when it is an interim chunk; `None`
    /// leaves it as sent.
    fn rewrite(&mut self, event: &[u8]) -> Option<Bytes> {
        let text = std::str::from_utf8(event).ok()?;
        let mut lines = text.split_inclusive('\n');
        let data_line = lines.next()?;
        // One `data:` line, then the blank line. Anything else passes through.
        if lines.any(|line| !line.trim_end_matches(['\r', '\n']).is_empty()) {
            return None;
        }
        let json = data_line.strip_prefix("data:")?.trim();
        let mut value: Value = serde_json::from_str(json).ok()?;

        // The same test metering uses for the final chunk.
        if value.pointer("/candidates/0/finishReason").is_some() {
            self.finished = true;
            return None;
        }
        // Usage alone, without candidates, is not an interim chunk.
        let has_candidates = value
            .get("candidates")
            .and_then(Value::as_array)
            .is_some_and(|candidates| !candidates.is_empty());
        if !has_candidates {
            // Rig saw this usage, so replaying an older one would undo it.
            if value.get("usageMetadata").is_some() {
                self.removed = None;
            }
            return None;
        }
        self.removed = Some(value.as_object_mut()?.remove("usageMetadata")?);

        let ending = if text.ends_with("\r\n\r\n") {
            "\r\n\r\n"
        } else {
            "\n\n"
        };
        Some(Bytes::from(format!(
            "data: {}{ending}",
            serde_json::to_string(&value).ok()?
        )))
    }
}
