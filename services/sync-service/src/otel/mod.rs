// This module's exporter/layer machinery is wired only in the wasm32 Worker
// branch (see lib.rs `inner_start`). On other targets (e.g. rust-analyzer's
// default host check) that wiring is cfg-excluded, so those items look unused;
// the lint stays active on wasm, where everything is used.
#![cfg_attr(not(target_arch = "wasm32"), allow(dead_code))]

mod exporter;
mod layer;
mod model;
mod proto;
mod trace_context;

pub use exporter::{configure, flush_into};
#[cfg(target_arch = "wasm32")]
pub use layer::OtelLayer;
pub use trace_context::{
    TRACEPARENT, TraceParent, remote_fields, traceparent_from_request, traceparent_value,
};

/// Reserved span field: 32-hex remote trace id. Set on locally-rooted spans
/// to join them to an upstream trace.
pub const REMOTE_TRACE_ID_FIELD: &str = "trace.remote_id";
/// Reserved span field: 16-hex remote parent span id.
pub const REMOTE_PARENT_FIELD: &str = "trace.remote_parent";
