use super::signal_endpoint;

#[test]
fn appends_signal_path_to_collector_endpoint() {
    assert_eq!(
        signal_endpoint("http://otel-collector:4318/", "traces"),
        "http://otel-collector:4318/v1/traces"
    );
    assert_eq!(
        signal_endpoint("http://otel-collector:4318/", "logs"),
        "http://otel-collector:4318/v1/logs"
    );
}
