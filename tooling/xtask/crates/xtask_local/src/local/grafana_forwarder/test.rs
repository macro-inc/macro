use super::export_endpoint;

#[test]
fn reads_the_lgtm_copy_endpoint_from_inspect_output() {
    let env = "GF_AUTH_ANONYMOUS_ENABLED=true\nOTEL_EXPORTER_OTLP_ENDPOINT=http://grafana-forwarder:4318\nPATH=/usr/bin\n";
    assert_eq!(export_endpoint(env), "http://grafana-forwarder:4318");
}

#[test]
fn an_unset_or_empty_copy_endpoint_is_empty() {
    assert_eq!(export_endpoint("GF_AUTH_ANONYMOUS_ENABLED=true\n"), "");
    assert_eq!(export_endpoint("OTEL_EXPORTER_OTLP_ENDPOINT=\n"), "");
    // A per-signal variable is not the switch run_local sets.
    assert_eq!(
        export_endpoint("OTEL_EXPORTER_OTLP_ENDPOINT_TRACES=http://elsewhere\n"),
        ""
    );
}
