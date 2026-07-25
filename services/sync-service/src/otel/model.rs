use web_time::{SystemTime, UNIX_EPOCH};

/// A `tracing` event (log line) recorded inside a span, exported as an OTLP
/// span event so backend logs — especially errors — are visible in traces.
pub(super) struct ClosedSpanEvent {
    pub(super) name: String,
    pub(super) time_ns: u64,
    pub(super) attrs: Vec<(String, String)>,
}

/// A closed span waiting for export.
pub(super) struct ClosedSpan {
    pub(super) data: LiveSpan,
    pub(super) name: &'static str,
    pub(super) level: &'static str,
    pub(super) file: Option<&'static str>,
    pub(super) line: Option<u32>,
    pub(super) end_ns: u64,
}

/// Per-span trace state stored in span extensions while the span is live.
pub(super) struct LiveSpan {
    pub(super) trace_id: [u8; 16],
    pub(super) span_id: [u8; 8],
    pub(super) parent_span_id: Option<[u8; 8]>,
    /// True when this span is the local root (its parent, if any, is remote).
    pub(super) local_root: bool,
    pub(super) start_ns: u64,
    pub(super) attrs: Vec<(String, String)>,
    pub(super) events: Vec<ClosedSpanEvent>,
    /// Message of the first ERROR-level event fired in this span; sets the
    /// OTLP span status (and thus the error message shown on the span).
    pub(super) error_message: Option<String>,
}

pub(super) fn now_unix_nanos() -> u64 {
    // web-time: Date.now() on wasm32-unknown-unknown, std::time natively.
    // std::time::Instant would panic on this wasm target.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or_default()
}

/// Random ids from uuid v4 (getrandom-js backed on wasm; already a dep).
pub(super) fn random_trace_id() -> [u8; 16] {
    uuid::Uuid::new_v4().into_bytes()
}

pub(super) fn random_span_id() -> [u8; 8] {
    // Bytes 8..16 of a v4 uuid: the variant bits guarantee non-zero.
    let bytes = uuid::Uuid::new_v4().into_bytes();
    bytes[8..16].try_into().expect("8-byte slice")
}
