use super::*;

#[test]
fn rollout_defaults_are_disabled_and_single_slot() {
    let config: Config = serde_json::from_value(serde_json::json!({
        "DATABASE_URL": "postgres://localhost/test",
        "UPLOAD_STAGING_BUCKET": "test-staging",
        "INTERNAL_API_KEY": "test-only"
    }))
    .unwrap();
    assert!(!config.slack_import_enabled);
    assert!(!config.slack_import_join_email_enabled);
    assert_eq!(config.slack_import_concurrency, 1);
    assert!(config.worker().is_ok());
}

#[test]
fn join_email_flag_follows_slack_import_join_email_enabled() {
    let config: Config = serde_json::from_value(serde_json::json!({
        "DATABASE_URL": "postgres://localhost/test",
        "UPLOAD_STAGING_BUCKET": "test-staging",
        "INTERNAL_API_KEY": "test-only",
        "SLACK_IMPORT_JOIN_EMAIL_ENABLED": true
    }))
    .unwrap();
    assert!(config.slack_import_join_email_enabled);
}

#[test]
fn rejects_unbounded_or_zero_concurrency_at_startup() {
    for concurrency in [0, 3, 255] {
        let config: Config = serde_json::from_value(serde_json::json!({
            "DATABASE_URL": "postgres://localhost/test",
            "UPLOAD_STAGING_BUCKET": "test-staging",
            "INTERNAL_API_KEY": "test-only",
            "SLACK_IMPORT_ENABLED": true,
            "SLACK_IMPORT_CONCURRENCY": concurrency
        }))
        .unwrap();
        assert!(config.worker().is_err());
    }
}
