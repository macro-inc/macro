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
use rig_core::providers::gemini::{
    completion::gemini_api_types::PartKind, streaming::StreamGenerateContentResponse,
};
use serde::Deserialize;
use serde_json::Value;

use super::{MAX_EVENT_BYTES, sanitize_gemini_4_error};
use crate::model::gemini_replay::{Capture, call_alias};

#[cfg(test)]
mod test;

/// `body` with usage removed from Gemini's interim chunks.
pub(super) fn without_interim_usage(
    mut body: BoxedStream,
    capture: Option<Capture>,
) -> BoxedStream {
    Box::pin(async_stream::stream! {
        let mut filter = InterimUsageFilter { capture, ..Default::default() };
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
                    let error = if filter.capture.is_some() {
                        sanitize_gemini_4_error(error)
                    } else {
                        error
                    };
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
    capture: Option<Capture>,
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
            return if self.capture.is_some() {
                Bytes::new()
            } else {
                Bytes::copy_from_slice(bytes)
            };
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
            if let Some(capture) = self.capture.as_mut() {
                capture.invalidate();
            }
            self.passthrough = true;
            // The final chunk now passes unread; replaying interim usage
            // after it would undo it.
            self.removed = None;
            if self.capture.is_some() {
                self.pending.clear();
            } else {
                out.extend_from_slice(&self.pending.split());
            }
        }
        out.freeze()
    }

    /// Whatever is left when the body ends, unchanged. A stream that ended
    /// before its final chunk gets the last usage it carried back, as an
    /// event of its own, so rig still reports the prompt it sent.
    fn finish(&mut self) -> Bytes {
        let mut rest = self.pending.split();
        if let Some(capture) = self.capture.as_mut()
            && !rest.is_empty()
        {
            capture.invalidate();
            rest.clear();
        }
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
        let Some((text, mut value)) = parse_event(event) else {
            if let Some(capture) = self.capture.as_mut() {
                let comment = event
                    .split(|byte| *byte == b'\n')
                    .all(|line| line.is_empty() || line == b"\r" || line.starts_with(b":"));
                if !comment {
                    capture.invalidate();
                }
                return Some(Bytes::new());
            }
            return None;
        };
        let private = self.capture.is_some();
        if let Some(capture) = self.capture.as_mut() {
            if !supported_private_event(&value) {
                capture.invalidate();
                return Some(Bytes::new());
            }
            if !capture.event(&value, event.len()) {
                return Some(Bytes::new());
            }
            redact_private_parts(&mut value);
        }

        // The same test metering uses for the final chunk.
        if value.pointer("/candidates/0/finishReason").is_some() {
            self.finished = true;
            return private.then(|| encode_event(text, &value));
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
            return private.then(|| encode_event(text, &value));
        }
        if let Some(usage) = value.as_object_mut()?.remove("usageMetadata") {
            self.removed = Some(usage);
        } else if !private {
            return None;
        }
        Some(encode_event(text, &value))
    }
}

fn encode_event(original: &str, value: &Value) -> Bytes {
    let ending = if original.ends_with("\r\n\r\n") {
        "\r\n\r\n"
    } else {
        "\n\n"
    };
    Bytes::from(format!("data: {value}{ending}"))
}

// Validate with Rig's own schema before passing bytes to its SSE reader,
// which can log rejected JSON and unsupported parts.
fn supported_private_event(value: &Value) -> bool {
    if !value.is_object() || value.get("error").is_some_and(|error| !error.is_null()) {
        return false;
    }
    StreamGenerateContentResponse::deserialize(value).is_ok_and(|response| {
        response.candidates.len() <= 1
            && response.candidates.into_iter().all(|candidate| {
                candidate.content.is_none_or(|content| {
                    content.parts.into_iter().all(|part| {
                        part.thought != Some(true)
                            && match &part.part {
                                PartKind::Text(_) => true,
                                PartKind::FunctionCall(call) => {
                                    call.args.is_object()
                                        && call.id.as_deref().is_some_and(|id| !id.is_empty())
                                }
                                _ => false,
                            }
                            && part.additional_params.as_ref().is_none_or(|value| {
                                value.as_object().is_some_and(serde_json::Map::is_empty)
                            })
                    })
                })
            })
    })
}

fn redact_private_parts(value: &mut Value) {
    if let Some(event) = value.as_object_mut() {
        event.retain(|name, value| match name.as_str() {
            "candidates" | "usageMetadata" => true,
            "modelVersion" => matches!(value.as_str(), Some("gemini-4-neon" | "gemini-4-carbon")),
            _ => false,
        });
    }
    if let Some(candidates) = value.get_mut("candidates").and_then(Value::as_array_mut) {
        for candidate in candidates {
            if let Some(candidate) = candidate.as_object_mut() {
                candidate.retain(|name, _| matches!(name.as_str(), "content" | "finishReason"));
            }
            if let Some(parts) = candidate
                .pointer_mut("/content/parts")
                .and_then(Value::as_array_mut)
            {
                for part in parts.iter_mut().filter_map(Value::as_object_mut) {
                    part.remove("thoughtSignature");
                    if let Some(call) = part.get_mut("functionCall")
                        && let Some(id) = call["id"].as_str()
                    {
                        call["id"] = Value::from(call_alias(id));
                    }
                }
            }
        }
    }
}

fn parse_event(event: &[u8]) -> Option<(&str, Value)> {
    let text = std::str::from_utf8(event).ok()?;
    let mut lines = text.split_inclusive('\n');
    let data_line = lines.next()?;
    // One data line followed by the blank line.
    if lines.any(|line| !line.trim_end_matches(['\r', '\n']).is_empty()) {
        return None;
    }
    let json = data_line.strip_prefix("data:")?.trim();
    Some((text, serde_json::from_str(json).ok()?))
}
