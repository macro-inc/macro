use opentelemetry_proto::tonic::{
    collector::trace::v1::ExportTraceServiceRequest,
    common::v1::{AnyValue, InstrumentationScope, KeyValue, any_value},
    resource::v1::Resource,
    trace::v1::{
        ResourceSpans, ScopeSpans, Span, Status, span::Event, span::SpanKind, status::StatusCode,
    },
};

use super::model::ClosedSpan;

fn string_kv(key: &str, value: &str) -> KeyValue {
    owned_kv(key.to_string(), value.to_string())
}

fn owned_kv(key: String, value: String) -> KeyValue {
    KeyValue {
        key,
        value: Some(AnyValue {
            value: Some(any_value::Value::StringValue(value)),
        }),
    }
}

fn span_proto(s: ClosedSpan) -> Span {
    let data = s.data;
    let mut attributes: Vec<KeyValue> = data
        .attrs
        .into_iter()
        .map(|(k, v)| owned_kv(k, v))
        .collect();
    attributes.push(string_kv("level", s.level));
    if let Some(file) = s.file {
        attributes.push(string_kv("code.filepath", file));
    }
    if let Some(line) = s.line {
        attributes.push(KeyValue {
            key: "code.lineno".to_string(),
            value: Some(AnyValue {
                value: Some(any_value::Value::IntValue(i64::from(line))),
            }),
        });
    }
    let events = data
        .events
        .into_iter()
        .map(|e| Event {
            time_unix_nano: e.time_ns,
            name: e.name,
            attributes: e.attrs.into_iter().map(|(k, v)| owned_kv(k, v)).collect(),
            ..Default::default()
        })
        .collect();
    Span {
        // Raw ids: the OTLP/JSON serde impl renders these byte fields as hex.
        trace_id: data.trace_id.to_vec(),
        span_id: data.span_id.to_vec(),
        parent_span_id: data.parent_span_id.map(|p| p.to_vec()).unwrap_or_default(),
        name: s.name.to_string(),
        // SERVER for local roots (they answer a remote request), else INTERNAL.
        kind: if data.local_root {
            SpanKind::Server
        } else {
            SpanKind::Internal
        } as i32,
        start_time_unix_nano: data.start_ns,
        end_time_unix_nano: s.end_ns,
        attributes,
        events,
        // Mark the span errored when it carried an ERROR-level event, so it
        // surfaces as a failed span — with that event's message as the
        // span's error message — in the tracing backend.
        status: data.error_message.map(|message| Status {
            code: StatusCode::Error as i32,
            message,
        }),
        ..Default::default()
    }
}

pub(super) fn export_request(
    spans: Vec<ClosedSpan>,
    environment: Option<&str>,
) -> ExportTraceServiceRequest {
    let mut resource_attrs = vec![string_kv("service.name", "sync-service")];
    if let Some(env) = environment {
        resource_attrs.push(string_kv("deployment.environment", env));
    }
    ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: resource_attrs,
                ..Default::default()
            }),
            scope_spans: vec![ScopeSpans {
                scope: Some(InstrumentationScope {
                    name: "sync-service".to_string(),
                    ..Default::default()
                }),
                spans: spans.into_iter().map(span_proto).collect(),
                ..Default::default()
            }],
            ..Default::default()
        }],
    }
}
