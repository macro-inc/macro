//! Reading a run's SSE body, with the diagnostics a failure needs.
//!
//! reqwest reports every mid-body failure as `error decoding response body`
//! and, since 0.12, keeps the cause out of `Display`: the hyper, h2, or io
//! error underneath — a reset, an incomplete message, an h2 stream error —
//! is reachable only through `source()`. Eight runs in one day (prod,
//! 2026-09-26) failed with exactly that sentence and nothing else, which is
//! why this module exists. It keeps the facts of the connection and the tail
//! of its bytes, and writes them all down the moment the body fails.

#[cfg(test)]
mod test;

use crate::api::record::SseRecording;
use crate::domain::journal::NativeRecord;
use base64::Engine as _;
use futures::stream::BoxStream;
use futures::{Stream, StreamExt as _};
use sse_core::SseEvent;
use std::collections::VecDeque;
use std::num::NonZeroUsize;
use std::time::Instant;

/// Raw bytes kept from the tail of a connection, for the report a body
/// failure writes. 4 KiB: several SSE records' worth, enough to see whether
/// the last one was cut mid-frame, small enough to base64 into one log line.
pub(crate) const TAIL_BYTES: usize = 4096;

/// The header Cloudflare stamps a request with; the id to quote to Cursor.
const CF_RAY_HEADER: &str = "cf-ray";

/// Generic request-id headers, tried after [`CF_RAY_HEADER`].
const REQUEST_ID_HEADERS: [&str; 2] = ["x-request-id", "x-amzn-requestid"];

/// What a stream connection looked like when it was made.
///
/// Captured from the response headers before the body is read, because by
/// the time the body fails the response is gone and these are the only
/// things that say which server, over which protocol, with which encoding,
/// was on the other end.
#[derive(Debug, Clone)]
pub(crate) struct ConnectionFacts {
    /// The response status.
    pub status: u16,
    /// The HTTP version negotiated, `HTTP/1.1` or `HTTP/2.0`.
    pub version: String,
    /// `content-type`, expected `text/event-stream`.
    pub content_type: Option<String>,
    /// `content-encoding`. Expected absent: the request asks for identity,
    /// and a compressed event stream is buffered by whatever decodes it.
    pub content_encoding: Option<String>,
    /// `transfer-encoding`, `chunked` over HTTP/1.1.
    pub transfer_encoding: Option<String>,
    /// The `server` header, when one was sent.
    pub server: Option<String>,
    /// `cf-ray`, else `x-request-id`, else `x-amzn-requestid`.
    pub request_id: Option<String>,
    /// Whether the connection resumed from a `Last-Event-ID`.
    pub resumed: bool,
}

impl ConnectionFacts {
    /// Read the facts off a response before its body is consumed.
    pub(crate) fn of(response: &reqwest::Response, resumed: bool) -> Self {
        let header = |name: &str| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(str::to_owned)
        };
        Self {
            status: response.status().as_u16(),
            version: format!("{:?}", response.version()),
            content_type: header(reqwest::header::CONTENT_TYPE.as_str()),
            content_encoding: header(reqwest::header::CONTENT_ENCODING.as_str()),
            transfer_encoding: header(reqwest::header::TRANSFER_ENCODING.as_str()),
            server: header(reqwest::header::SERVER.as_str()),
            request_id: header(CF_RAY_HEADER)
                .or_else(|| REQUEST_ID_HEADERS.iter().find_map(|name| header(name))),
            resumed,
        }
    }

    /// Whether the body arrived compressed, which the request asked it not
    /// to. Worth a warning of its own: a decoder between the socket and the
    /// SSE parser buffers until it has a whole block, and fails at whatever
    /// boundary the server cut.
    pub(crate) fn is_compressed(&self) -> bool {
        self.content_encoding
            .as_deref()
            .is_some_and(|encoding| !encoding.eq_ignore_ascii_case("identity"))
    }
}

/// The last [`TAIL_BYTES`] bytes a connection delivered, in order.
#[derive(Debug, Default)]
pub(crate) struct Tail {
    bytes: VecDeque<u8>,
}

impl Tail {
    /// Remember `chunk`, forgetting whatever is now past the window.
    pub(crate) fn push(&mut self, chunk: &[u8]) {
        if chunk.len() >= TAIL_BYTES {
            self.bytes.clear();
            self.bytes.extend(&chunk[chunk.len() - TAIL_BYTES..]);
            return;
        }
        let overflow = (self.bytes.len() + chunk.len()).saturating_sub(TAIL_BYTES);
        self.bytes.drain(..overflow);
        self.bytes.extend(chunk);
    }

    /// The window's bytes, oldest first.
    pub(crate) fn bytes(&self) -> Vec<u8> {
        self.bytes.iter().copied().collect()
    }
}

/// The bytes after the last blank line: the record a connection was in the
/// middle of when it ended, or nothing when it ended between records.
///
/// SSE ends a record with a blank line, which is `\n\n` or `\r\n\r\n` on the
/// wire; whichever came last is the boundary.
pub(crate) fn partial_frame(bytes: &[u8]) -> &[u8] {
    let after_lf = bytes
        .windows(2)
        .rposition(|window| window == b"\n\n")
        .map(|at| at + 2);
    let after_crlf = bytes
        .windows(4)
        .rposition(|window| window == b"\r\n\r\n")
        .map(|at| at + 4);
    let start = after_lf.max(after_crlf).unwrap_or(0);
    &bytes[start..]
}

/// Every message in an error's `source()` chain, outermost first, joined
/// with `: ` — what `Display` would have said before the convention that
/// each error names only itself.
pub(crate) fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut chain = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let message = cause.to_string();
        // An error that already restates its cause in its own message would
        // otherwise say it twice.
        if !chain.ends_with(&message) {
            chain.push_str(": ");
            chain.push_str(&message);
        }
        source = cause.source();
    }
    chain
}

/// A lossy UTF-8 rendering of `bytes`, with control characters escaped so it
/// stays on one log line.
fn preview(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .flat_map(|character| {
            if character.is_control() && character != ' ' {
                character.escape_default().collect::<Vec<_>>()
            } else {
                vec![character]
            }
        })
        .collect()
}

/// One connection's body, being read.
struct Reader {
    bytes: BoxStream<'static, reqwest::Result<bytes::Bytes>>,
    decoder: sse_core::SseDecoder,
    /// Records decoded from the last chunk and not yet yielded; one read can
    /// complete several.
    pending: VecDeque<Result<NativeRecord, rootcause::Report>>,
    recording: SseRecording,
    facts: ConnectionFacts,
    tail: Tail,
    connected_at: Instant,
    last_chunk_at: Option<Instant>,
    last_record_at: Option<Instant>,
    bytes_received: u64,
    chunks_received: u64,
    records_decoded: u64,
    limit: NonZeroUsize,
}

impl Reader {
    fn since(&self, at: Option<Instant>) -> Option<u64> {
        at.map(|at| at.elapsed().as_millis() as u64)
    }

    /// Write down everything known about a body that just failed, and
    /// answer with the report the domain journals.
    ///
    /// The log line carries the raw tail — base64 for the bytes as they
    /// were, a lossy preview for a person reading it — and the partial SSE
    /// frame the connection was cut in. The report carries only the error
    /// chain and the counts: it becomes a journal entry, and 4 KiB of
    /// base64 per interruption belongs in logs, not in the durable record.
    fn failure(&self, error: &reqwest::Error) -> rootcause::Report {
        let chain = error_chain(error);
        let tail = self.tail.bytes();
        let partial = partial_frame(&tail);
        let connected_ms = self.connected_at.elapsed().as_millis() as u64;
        let since_last_record_ms = self.since(self.last_record_at);
        tracing::warn!(
            cursor.stream.error = %chain,
            cursor.stream.error_is_decode = error.is_decode(),
            cursor.stream.error_is_timeout = error.is_timeout(),
            cursor.stream.error_is_connect = error.is_connect(),
            cursor.stream.status = self.facts.status,
            cursor.stream.http_version = %self.facts.version,
            cursor.stream.content_type = self.facts.content_type.as_deref(),
            cursor.stream.content_encoding = self.facts.content_encoding.as_deref(),
            cursor.stream.transfer_encoding = self.facts.transfer_encoding.as_deref(),
            cursor.stream.server = self.facts.server.as_deref(),
            cursor.stream.request_id = self.facts.request_id.as_deref(),
            cursor.stream.resumed = self.facts.resumed,
            cursor.stream.bytes_received = self.bytes_received,
            cursor.stream.chunks_received = self.chunks_received,
            cursor.stream.records_decoded = self.records_decoded,
            cursor.stream.connected_ms = connected_ms,
            cursor.stream.since_last_chunk_ms = self.since(self.last_chunk_at),
            cursor.stream.since_last_record_ms = since_last_record_ms,
            cursor.stream.last_event_id = self.decoder.last_event_id().map(|id| id.to_string()),
            cursor.stream.tail_bytes = tail.len(),
            cursor.stream.tail_base64 = %base64::engine::general_purpose::STANDARD.encode(&tail),
            cursor.stream.tail_preview = %preview(&tail),
            cursor.stream.partial_frame_bytes = partial.len(),
            cursor.stream.partial_frame = %preview(partial),
            cursor.stream.decoder = ?self.decoder,
            "Cursor stream body failed"
        );
        rootcause::report!(
            "{chain} (after {} bytes and {} records in {}s; {} since the last record)",
            self.bytes_received,
            self.records_decoded,
            connected_ms / 1000,
            since_last_record_ms
                .map(|ms| format!("{}s", ms / 1000))
                .unwrap_or_else(|| "none received".to_owned()),
        )
        .into_dynamic()
    }

    /// Note how a body ended. A partial frame at the end means the server
    /// cut a record in two, which the domain is about to hear as a plain
    /// close: worth a warning, so the two can be told apart later.
    fn ended(&self) {
        let tail = self.tail.bytes();
        let partial = partial_frame(&tail);
        if partial.is_empty() {
            tracing::debug!(
                cursor.stream.bytes_received = self.bytes_received,
                cursor.stream.records_decoded = self.records_decoded,
                cursor.stream.connected_ms = self.connected_at.elapsed().as_millis() as u64,
                cursor.stream.resumed = self.facts.resumed,
                "Cursor stream body ended"
            );
            return;
        }
        tracing::warn!(
            cursor.stream.bytes_received = self.bytes_received,
            cursor.stream.records_decoded = self.records_decoded,
            cursor.stream.connected_ms = self.connected_at.elapsed().as_millis() as u64,
            cursor.stream.resumed = self.facts.resumed,
            cursor.stream.request_id = self.facts.request_id.as_deref(),
            cursor.stream.partial_frame_bytes = partial.len(),
            cursor.stream.partial_frame = %preview(partial),
            "Cursor stream body ended mid-record"
        );
    }

    /// Decode one chunk into `pending`, whole records only.
    fn decode(&mut self, chunk: bytes::Bytes) {
        self.chunks_received += 1;
        self.bytes_received += chunk.len() as u64;
        self.last_chunk_at = Some(Instant::now());
        self.recording.write(&chunk);
        self.tail.push(&chunk);
        let mut cursor = chunk;
        while let Some(record) = self.decoder.next(&mut cursor) {
            // A payload past the limit is the run's problem, not this
            // stream's shape: report it and stop rather than resync
            // mid-record.
            let record = match record {
                Ok(record) => record,
                Err(error) => {
                    // Deliver every earlier complete record in this chunk
                    // before the decoder error.
                    self.pending.push_back(Err(rootcause::report!(
                        "cursor sse payload over {} bytes: {error}",
                        self.limit
                    )
                    .into_dynamic()));
                    break;
                }
            };
            let SseEvent::Message(message) = record else {
                continue; // `retry:`; the domain drives reconnects
            };
            self.records_decoded += 1;
            self.last_record_at = Some(Instant::now());
            self.pending.push_back(Ok(NativeRecord {
                event: message.event.into_owned(),
                data: message.data,
                id: message.last_event_id.map(|id| id.to_string()),
            }));
        }
    }
}

/// The complete SSE records of `response`'s body, as a stream.
///
/// Decodes incrementally: SSE records straddle read boundaries, so the
/// decoder holds a partial record in its own buffers and only whole ones are
/// yielded. `recording` taps the bytes before the decoder sees them, so a
/// fixture is byte-identical to the wire. `limit` bounds one record's
/// payload; see [`crate::api::MAX_SSE_PAYLOAD`].
pub(crate) fn records(
    response: reqwest::Response,
    facts: ConnectionFacts,
    recording: SseRecording,
    limit: NonZeroUsize,
) -> impl Stream<Item = Result<NativeRecord, rootcause::Report>> + Send {
    let reader = Reader {
        bytes: response.bytes_stream().boxed(),
        decoder: sse_core::SseDecoder::with_limit(limit),
        pending: VecDeque::new(),
        recording,
        facts,
        tail: Tail::default(),
        connected_at: Instant::now(),
        last_chunk_at: None,
        last_record_at: None,
        bytes_received: 0,
        chunks_received: 0,
        records_decoded: 0,
        limit,
    };
    futures::stream::try_unfold(reader, |mut reader| async move {
        loop {
            if let Some(record) = reader.pending.pop_front() {
                return Ok(Some((record?, reader)));
            }
            match reader.bytes.next().await {
                Some(Ok(chunk)) => reader.decode(chunk),
                Some(Err(error)) => return Err(reader.failure(&error)),
                None => {
                    reader.ended();
                    return Ok(None);
                }
            }
        }
    })
}
