//! Carrying a trace across a wait.
//!
//! A request's trace ends when the request does. Work the harness defers -
//! chiefly a queued prompt, which runs whenever the turn ahead of it ends -
//! therefore runs in a trace of its own, with nothing tying it back to the
//! person who asked for it. That gap is the wait itself: the queue's whole
//! job, and the part nobody can see.
//!
//! Captured at admission and attached at dispatch as a span *link*: the
//! dispatch belongs to the turn end that caused it, and the link says which
//! request it is finally answering. Parenting instead would move the dispatch
//! out of the trace it actually happened in.

use std::collections::HashMap;

use opentelemetry::trace::TraceContextExt;
use tracing_opentelemetry::OpenTelemetrySpanExt;

/// A W3C trace context, carried as the propagator's own key/value form so
/// nothing here has to know which fields a propagator uses.
#[derive(Debug, Clone, Default)]
pub struct TraceContext(HashMap<String, String>);

impl TraceContext {
    /// The context of the span in scope right now. Empty when tracing is not
    /// configured, which makes [`Self::link`] a no-op.
    #[must_use]
    pub fn capture() -> Self {
        let context = tracing::Span::current().context();
        let mut carrier = HashMap::new();
        opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.inject_context(&context, &mut carrier);
        });
        Self(carrier)
    }

    /// Link `span` to the captured context. Silently does nothing when the
    /// carrier is empty or unsampled - a missing link must never be worth an
    /// error on the path it is observing.
    pub fn link(&self, span: &tracing::Span) {
        if self.0.is_empty() {
            return;
        }
        let context = opentelemetry::global::get_text_map_propagator(|propagator| {
            propagator.extract(&self.0)
        });
        let span_context = context.span().span_context().clone();
        if !span_context.is_valid() {
            return;
        }
        span.add_link(span_context);
    }
}
