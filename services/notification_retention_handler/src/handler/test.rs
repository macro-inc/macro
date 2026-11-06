use super::*;

#[test]
fn manual_invocation_is_read_only_unless_explicitly_requested() {
    for payload in ["{}", r#"{"dry_run":true}"#] {
        let event: CleanupEvent = serde_json::from_str(payload).unwrap();
        assert_eq!(event.mode(), RetentionMode::DryRun);
    }
    let event: CleanupEvent = serde_json::from_str(r#"{"dry_run":false}"#).unwrap();
    assert_eq!(event.mode(), RetentionMode::Delete);
}

#[test]
fn invalid_or_unsupported_settings_fail_closed() {
    for payload in [
        r#"{"dry_run":null}"#,
        r#"{"dry_run":"false"}"#,
        r#"{"dryRun":false}"#,
        r#"{"dry_run":false,"retention_days":0}"#,
    ] {
        assert!(serde_json::from_str::<CleanupEvent>(payload).is_err());
    }
}
