use web_time::{SystemTime, UNIX_EPOCH};

pub(super) struct ClosedSpanEvent {
    pub(super) name: String,
    pub(super) time_ns: u64,
    pub(super) attrs: Vec<(String, String)>,
}

pub(super) struct ClosedSpan {
    pub(super) data: LiveSpan,
    pub(super) service_name: &'static str,
    pub(super) name: &'static str,
    pub(super) level: &'static str,
    pub(super) file: Option<&'static str>,
    pub(super) line: Option<u32>,
    pub(super) end_ns: u64,
}

pub(super) struct ClosedLog {
    pub(super) service_name: &'static str,
    pub(super) time_ns: u64,
    pub(super) level: tracing::Level,
    pub(super) body: String,
    pub(super) attrs: Vec<(String, String)>,
    pub(super) target: &'static str,
    pub(super) file: Option<&'static str>,
    pub(super) line: Option<u32>,
    pub(super) trace_id: Option<[u8; 16]>,
    pub(super) span_id: Option<[u8; 8]>,
}

pub(super) struct LiveSpan {
    pub(super) trace_id: [u8; 16],
    pub(super) span_id: [u8; 8],
    pub(super) parent_span_id: Option<[u8; 8]>,
    pub(super) local_root: bool,
    pub(super) start_ns: u64,
    pub(super) attrs: Vec<(String, String)>,
    pub(super) events: Vec<ClosedSpanEvent>,
    pub(super) error_message: Option<String>,
}

pub(super) fn now_unix_nanos() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or_default()
}

pub(super) fn random_trace_id() -> [u8; 16] {
    uuid::Uuid::new_v4().into_bytes()
}

pub(super) fn random_span_id() -> [u8; 8] {
    let bytes = uuid::Uuid::new_v4().into_bytes();
    bytes[8..16].try_into().expect("8-byte slice")
}
