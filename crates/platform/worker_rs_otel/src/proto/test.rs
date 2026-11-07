use opentelemetry_proto::tonic::{common::v1::any_value, logs::v1::SeverityNumber};

use super::export_logs_request;
use crate::model::ClosedLog;

#[test]
fn builds_correlated_log_record() {
    let request = export_logs_request(
        vec![ClosedLog {
            service_name: "sync-service",
            time_ns: 42,
            level: tracing::Level::WARN,
            body: "peer send failed".to_string(),
            attrs: vec![("document.id".to_string(), "doc-1".to_string())],
            target: "sync_service::websocket",
            file: Some("src/websocket.rs"),
            line: Some(10),
            trace_id: Some([1; 16]),
            span_id: Some([2; 8]),
        }],
        Some("test"),
    );

    let record = &request.resource_logs[0].scope_logs[0].log_records[0];
    assert_eq!(record.severity_number, SeverityNumber::Warn as i32);
    assert_eq!(record.trace_id, vec![1; 16]);
    assert_eq!(record.span_id, vec![2; 8]);
    assert!(matches!(
        record.body.as_ref().and_then(|body| body.value.as_ref()),
        Some(any_value::Value::StringValue(value)) if value == "peer send failed"
    ));
}
