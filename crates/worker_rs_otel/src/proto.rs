use opentelemetry_proto::tonic::{
    collector::{logs::v1::ExportLogsServiceRequest, trace::v1::ExportTraceServiceRequest},
    common::v1::{AnyValue, InstrumentationScope, KeyValue, any_value},
    logs::v1::{LogRecord, ResourceLogs, ScopeLogs, SeverityNumber},
    resource::v1::Resource,
    trace::v1::{
        ResourceSpans, ScopeSpans, Span, Status, span::Event, span::SpanKind, status::StatusCode,
    },
};

use super::model::{ClosedLog, ClosedSpan};

fn string_value(value: &str) -> AnyValue {
    AnyValue {
        value: Some(any_value::Value::StringValue(value.to_string())),
    }
}

fn string_kv(key: &str, value: &str) -> KeyValue {
    KeyValue {
        key: key.to_string(),
        value: Some(string_value(value)),
    }
}

fn span_proto(span: ClosedSpan) -> Span {
    let data = span.data;
    let mut attributes: Vec<KeyValue> = data
        .attrs
        .into_iter()
        .map(|(key, value)| string_kv(&key, &value))
        .collect();
    attributes.push(string_kv("level", span.level));
    if let Some(file) = span.file {
        attributes.push(string_kv("code.filepath", file));
    }
    if let Some(line) = span.line {
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
        .map(|event| Event {
            time_unix_nano: event.time_ns,
            name: event.name,
            attributes: event
                .attrs
                .into_iter()
                .map(|(key, value)| string_kv(&key, &value))
                .collect(),
            ..Default::default()
        })
        .collect();
    Span {
        trace_id: data.trace_id.to_vec(),
        span_id: data.span_id.to_vec(),
        parent_span_id: data.parent_span_id.map(|p| p.to_vec()).unwrap_or_default(),
        name: span.name.to_string(),
        kind: if data.local_root {
            SpanKind::Server
        } else {
            SpanKind::Internal
        } as i32,
        start_time_unix_nano: data.start_ns,
        end_time_unix_nano: span.end_ns,
        flags: 1,
        attributes,
        events,
        status: data.error_message.map(|message| Status {
            code: StatusCode::Error as i32,
            message,
        }),
        ..Default::default()
    }
}

pub(super) fn export_traces_request(
    spans: Vec<ClosedSpan>,
    environment: Option<&str>,
) -> ExportTraceServiceRequest {
    let service_name = spans
        .first()
        .map(|span| span.service_name)
        .unwrap_or("unknown-service");
    let mut resource_attrs = vec![string_kv("service.name", service_name)];
    if let Some(environment) = environment {
        resource_attrs.push(string_kv("deployment.environment", environment));
    }
    ExportTraceServiceRequest {
        resource_spans: vec![ResourceSpans {
            resource: Some(Resource {
                attributes: resource_attrs,
                ..Default::default()
            }),
            scope_spans: vec![ScopeSpans {
                scope: Some(InstrumentationScope {
                    name: service_name.to_string(),
                    ..Default::default()
                }),
                spans: spans.into_iter().map(span_proto).collect(),
                ..Default::default()
            }],
            ..Default::default()
        }],
    }
}

fn severity_number(level: tracing::Level) -> SeverityNumber {
    match level {
        tracing::Level::ERROR => SeverityNumber::Error,
        tracing::Level::WARN => SeverityNumber::Warn,
        tracing::Level::INFO => SeverityNumber::Info,
        tracing::Level::DEBUG => SeverityNumber::Debug,
        tracing::Level::TRACE => SeverityNumber::Trace,
    }
}

fn log_proto(log: ClosedLog) -> LogRecord {
    let correlated = log.trace_id.is_some();
    let mut attributes: Vec<KeyValue> = log
        .attrs
        .into_iter()
        .map(|(key, value)| string_kv(&key, &value))
        .collect();
    attributes.push(string_kv("target", log.target));
    if let Some(file) = log.file {
        attributes.push(string_kv("code.filepath", file));
    }
    if let Some(line) = log.line {
        attributes.push(KeyValue {
            key: "code.lineno".to_string(),
            value: Some(AnyValue {
                value: Some(any_value::Value::IntValue(i64::from(line))),
            }),
        });
    }
    LogRecord {
        time_unix_nano: log.time_ns,
        observed_time_unix_nano: log.time_ns,
        severity_number: severity_number(log.level) as i32,
        severity_text: log.level.as_str().to_string(),
        body: Some(string_value(&log.body)),
        attributes,
        flags: u32::from(correlated),
        trace_id: log.trace_id.map(|id| id.to_vec()).unwrap_or_default(),
        span_id: log.span_id.map(|id| id.to_vec()).unwrap_or_default(),
        ..Default::default()
    }
}

pub(super) fn export_logs_request(
    logs: Vec<ClosedLog>,
    environment: Option<&str>,
) -> ExportLogsServiceRequest {
    let service_name = logs
        .first()
        .map(|log| log.service_name)
        .unwrap_or("unknown-service");
    let mut resource_attrs = vec![string_kv("service.name", service_name)];
    if let Some(environment) = environment {
        resource_attrs.push(string_kv("deployment.environment", environment));
    }
    ExportLogsServiceRequest {
        resource_logs: vec![ResourceLogs {
            resource: Some(Resource {
                attributes: resource_attrs,
                ..Default::default()
            }),
            scope_logs: vec![ScopeLogs {
                scope: Some(InstrumentationScope {
                    name: service_name.to_string(),
                    ..Default::default()
                }),
                log_records: logs.into_iter().map(log_proto).collect(),
                ..Default::default()
            }],
            ..Default::default()
        }],
    }
}

#[cfg(test)]
mod test;
