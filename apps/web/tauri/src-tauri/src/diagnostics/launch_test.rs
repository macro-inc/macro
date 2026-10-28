use super::*;

#[test]
fn normal_and_deep_link_launches_do_not_record() {
    assert!(
        !LaunchOptions::try_parse_from(["macro"])
            .unwrap()
            .record_memory
    );
    let options = LaunchOptions::try_parse_from(["macro", "macro://app/channel/123"]).unwrap();
    assert!(!options.record_memory);
    assert_eq!(options.urls, ["macro://app/channel/123"]);
}

#[test]
fn recording_requires_an_explicit_valid_export_destination() {
    assert!(LaunchOptions::try_parse_from(["macro", "--record-memory"]).is_err());
    for url in [
        "file:///v1/traces",
        "https://user:secret@example.com/v1/traces",
        "https://example.com/",
        "https://example.com/v1/traces?token=secret",
    ] {
        assert!(
            LaunchOptions::try_parse_from(["macro", "--record-memory", "--otel-traces-url", url])
                .is_err()
        );
    }
    assert!(
        LaunchOptions::try_parse_from([
            "macro",
            "--record-memory",
            "--otel-traces-url",
            "http://localhost:4318/v1/traces"
        ])
        .unwrap()
        .record_memory
    );
}
