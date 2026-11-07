//! OpenTelemetry tracing support for Cloudflare Workers built with worker-rs.

mod exporter;
mod layer;
mod model;
mod proto;
mod trace_context;

use std::{future::Future, pin::Pin};

pub use layer::{OtelLayer, traceparent_for_span};
pub use trace_context::{
    HeadersLike, TRACEPARENT, parse_traceparent, remote_fields, traceparent_from_headers,
    traceparent_from_request,
};

/// Reserved span field containing a 32-character hexadecimal remote trace ID.
pub const REMOTE_TRACE_ID_FIELD: &str = "trace.remote_id";
/// Reserved span field containing a 16-character hexadecimal remote parent span ID.
pub const REMOTE_PARENT_FIELD: &str = "trace.remote_parent";

type ExportFuture = Pin<Box<dyn Future<Output = ()> + 'static>>;

/// Registers background work against the current Cloudflare invocation.
pub trait WaitUntil {
    /// Keep the invocation alive until `future` completes.
    fn wait_until(&self, future: ExportFuture);
}

impl WaitUntil for worker::Context {
    fn wait_until(&self, future: ExportFuture) {
        worker::Context::wait_until(self, future);
    }
}

impl WaitUntil for worker::State {
    fn wait_until(&self, future: ExportFuture) {
        worker::State::wait_until(self, future);
    }
}

/// Run one Worker invocation and schedule its buffered telemetry for export.
pub async fn scope<T>(
    env: &worker::Env,
    wait_until: &impl WaitUntil,
    future: impl Future<Output = T>,
) -> T {
    exporter::configure(env);
    let output = future.await;
    exporter::flush_into(wait_until);
    output
}
