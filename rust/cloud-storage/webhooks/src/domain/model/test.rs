use super::*;

#[test]
fn webhook_status_db_roundtrip() {
    for status in [
        WebhookStatus::Enabled,
        WebhookStatus::Disabled,
        WebhookStatus::PausedDueToFailures,
        WebhookStatus::Deleted,
    ] {
        assert_eq!(WebhookStatus::from_db_str(status.as_str()), Some(status));
    }
    assert_eq!(WebhookStatus::from_db_str("bogus"), None);
}

#[test]
fn detects_reserved_headers_case_insensitively() {
    let mut headers = BTreeMap::new();
    headers.insert("X-Macro-Signature".to_string(), "x".to_string());
    assert_eq!(
        first_reserved_header(&headers),
        Some("X-Macro-Signature".to_string())
    );

    let mut ok = BTreeMap::new();
    ok.insert("Authorization".to_string(), "Bearer x".to_string());
    assert_eq!(first_reserved_header(&ok), None);
}
