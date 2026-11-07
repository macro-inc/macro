use super::Config;

#[test]
fn deployment_limits_and_environment_must_be_explicit() {
    let values = serde_json::json!({
        "ENVIRONMENT": "local",
        "DATABASE_URL": "postgres://localhost/macrodb",
        "INTERNAL_API_KEY": "local-internal-key",
        "REPO_STORAGE_ROOT": "/tmp/agent-git",
        "MAX_REPO_SIZE_BYTES": 524288000,
        "PUSHES_PER_MINUTE": 30
    });
    let config: Config = serde_json::from_value(values.clone()).unwrap();
    assert_eq!(config.max_repo_size_bytes, 524288000);
    assert_eq!(config.pushes_per_minute, 30);
    for key in ["ENVIRONMENT", "MAX_REPO_SIZE_BYTES", "PUSHES_PER_MINUTE"] {
        let mut incomplete = values.clone();
        incomplete.as_object_mut().unwrap().remove(key);
        let error = serde_json::from_value::<Config>(incomplete).err().unwrap();
        assert!(error.to_string().contains(key), "{error}");
    }
}
