use tracing::field::{Field, Visit};
use tracing_subscriber::{
    Layer,
    layer::Context as LayerContext,
    registry::{LookupSpan, Registry},
};

use super::exporter::{buffer_log, buffer_span};
use super::model::{
    ClosedLog, ClosedSpan, ClosedSpanEvent, LiveSpan, now_unix_nanos, random_span_id,
    random_trace_id,
};
use super::trace_context::{parse_span_id, parse_trace_id, sampled_traceparent};
use super::{REMOTE_PARENT_FIELD, REMOTE_TRACE_ID_FIELD};

#[derive(Default)]
struct FieldVisitor {
    remote_trace_id: Option<[u8; 16]>,
    remote_parent: Option<[u8; 8]>,
    fields: Vec<(String, String)>,
}

impl FieldVisitor {
    fn record(&mut self, field: &Field, value: String) {
        match field.name() {
            REMOTE_TRACE_ID_FIELD => self.remote_trace_id = parse_trace_id(&value),
            REMOTE_PARENT_FIELD => self.remote_parent = parse_span_id(&value),
            name => self.fields.push((name.to_string(), value)),
        }
    }
}

macro_rules! string_visit {
    ($ty:ty) => {
        impl Visit for $ty {
            fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
                self.record(field, format!("{value:?}"));
            }

            fn record_str(&mut self, field: &Field, value: &str) {
                self.record(field, value.to_string());
            }
        }
    };
}

string_visit!(FieldVisitor);

#[derive(Default)]
struct EventVisitor {
    message: Option<String>,
    fields: Vec<(String, String)>,
}

impl EventVisitor {
    fn record(&mut self, field: &Field, value: String) {
        if field.name() == "message" {
            self.message = Some(value);
        } else {
            self.fields.push((field.name().to_string(), value));
        }
    }
}

string_visit!(EventVisitor);

/// A tracing-subscriber layer that exports closed spans through OTLP/HTTP.
pub struct OtelLayer {
    service_name: &'static str,
}

impl OtelLayer {
    /// Create a layer that identifies exported resources as `service_name`.
    pub const fn new(service_name: &'static str) -> Self {
        Self { service_name }
    }
}

/// Build a sampled W3C `traceparent` value for a span managed by this layer.
pub fn traceparent_for_span(span: &tracing::Span) -> Option<String> {
    span.with_subscriber(|(id, dispatch)| {
        let registry = dispatch.downcast_ref::<Registry>()?;
        let span = registry.span(id)?;
        let extensions = span.extensions();
        let data = extensions.get::<LiveSpan>()?;
        sampled_traceparent(data.trace_id, data.span_id)
    })
    .flatten()
}

impl<S> Layer<S> for OtelLayer
where
    S: tracing::Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_new_span(
        &self,
        attrs: &tracing::span::Attributes<'_>,
        id: &tracing::span::Id,
        ctx: LayerContext<'_, S>,
    ) {
        let Some(span) = ctx.span(id) else { return };

        let mut visitor = FieldVisitor::default();
        attrs.record(&mut visitor);

        let parent = span.parent().and_then(|p| {
            let ext = p.extensions();
            ext.get::<LiveSpan>().map(|d| (d.trace_id, d.span_id))
        });

        let (trace_id, parent_span_id, local_root) = match parent {
            Some((trace_id, parent_span_id)) => (trace_id, Some(parent_span_id), false),
            None => match visitor.remote_trace_id {
                Some(remote_trace_id) => (remote_trace_id, visitor.remote_parent, true),
                None => (random_trace_id(), None, true),
            },
        };

        span.extensions_mut().insert(LiveSpan {
            trace_id,
            span_id: random_span_id(),
            parent_span_id,
            local_root,
            start_ns: now_unix_nanos(),
            attrs: visitor.fields,
            events: Vec::new(),
            error_message: None,
        });
    }

    fn on_event(&self, event: &tracing::Event<'_>, ctx: LayerContext<'_, S>) {
        if *event.metadata().level() > tracing::Level::INFO {
            return;
        }
        let mut visitor = EventVisitor::default();
        event.record(&mut visitor);
        let meta = event.metadata();
        let level = *meta.level();
        let name = visitor.message.unwrap_or_else(|| meta.name().to_string());
        let mut attrs = visitor.fields;
        attrs.push(("level".to_string(), level.as_str().to_string()));
        let time_ns = now_unix_nanos();
        let trace_context = ctx.event_span(event).and_then(|span| {
            let mut extensions = span.extensions_mut();
            let data = extensions.get_mut::<LiveSpan>()?;
            if level == tracing::Level::ERROR && data.error_message.is_none() {
                data.error_message = Some(name.clone());
            }
            data.events.push(ClosedSpanEvent {
                name: name.clone(),
                time_ns,
                attrs: attrs.clone(),
            });
            Some((data.trace_id, data.span_id))
        });
        let (trace_id, span_id) = trace_context
            .map(|(trace_id, span_id)| (Some(trace_id), Some(span_id)))
            .unwrap_or_default();
        buffer_log(ClosedLog {
            service_name: self.service_name,
            time_ns,
            level,
            body: name,
            attrs,
            target: meta.target(),
            file: meta.file(),
            line: meta.line(),
            trace_id,
            span_id,
        });
    }

    fn on_record(
        &self,
        id: &tracing::span::Id,
        values: &tracing::span::Record<'_>,
        ctx: LayerContext<'_, S>,
    ) {
        let Some(span) = ctx.span(id) else { return };
        let mut visitor = FieldVisitor::default();
        values.record(&mut visitor);
        if let Some(data) = span.extensions_mut().get_mut::<LiveSpan>() {
            data.attrs.append(&mut visitor.fields);
        }
    }

    fn on_close(&self, id: tracing::span::Id, ctx: LayerContext<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let Some(data) = span.extensions_mut().remove::<LiveSpan>() else {
            return;
        };
        let meta = span.metadata();
        buffer_span(ClosedSpan {
            data,
            service_name: self.service_name,
            name: meta.name(),
            level: meta.level().as_str(),
            file: meta.file(),
            line: meta.line(),
            end_ns: now_unix_nanos(),
        });
    }
}

#[cfg(test)]
mod test;
