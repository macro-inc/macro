use super::Config;

#[test]
fn missing_posthog_key_fails_config_loading() {
    let error = serde_json::from_value::<Config>(serde_json::json!({}))
        .err()
        .expect("missing PostHog configuration must fail startup");

    assert!(
        error
            .to_string()
            .contains("missing field `POSTHOG_API_KEY`")
    );
}
