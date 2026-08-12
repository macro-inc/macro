use super::*;

#[test]
fn keeps_resolved_database_url_when_shell_has_local_default() {
    assert!(!should_overlay_process_env(
        "DATABASE_URL",
        "postgres://user:password@localhost:5432/macrodb"
    ));
    assert!(!should_overlay_process_env(
        "DATABASE_URL",
        "postgres://user:password@postgres:5432/macrodb"
    ));
}

#[test]
fn still_allows_non_local_database_overrides() {
    assert!(should_overlay_process_env(
        "DATABASE_URL",
        "postgres://user:password@dev.example.com:5432/macrodb"
    ));
}

#[test]
fn blank_relay_secret_counts_as_absent() {
    let mut env = BTreeMap::new();
    assert!(!calendar_push_secret_ok(&env));
    env.insert("CALENDAR_WATCH_RELAY_SECRET".into(), "   ".into());
    assert!(!calendar_push_secret_ok(&env));
    env.insert("CALENDAR_WATCH_RELAY_SECRET".into(), "s3cret".into());
    assert!(calendar_push_secret_ok(&env));
}

#[test]
fn stripping_the_overlay_keeps_later_layer_overrides() {
    let overlay: BTreeMap<String, String> = [
        ("CALENDAR_WATCH_WEBHOOK_URL", "https://dev/notifications"),
        ("CALENDAR_WATCH_RELAY_URL", "https://dev"),
        ("CALENDAR_WATCH_TOKEN", "overlay-token"),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_owned(), v.to_owned()))
    .collect();
    let mut env = overlay.clone();
    env.insert("CALENDAR_WATCH_TOKEN".into(), "env-file-token".into());
    env.insert("UNRELATED".into(), "kept".into());

    strip_calendar_push_overlay(&mut env, &overlay);

    assert!(!env.contains_key("CALENDAR_WATCH_WEBHOOK_URL"));
    assert!(!env.contains_key("CALENDAR_WATCH_RELAY_URL"));
    assert_eq!(
        env.get("CALENDAR_WATCH_TOKEN").map(String::as_str),
        Some("env-file-token"),
        "an --env-file override is the developer's choice and survives"
    );
    assert_eq!(env.get("UNRELATED").map(String::as_str), Some("kept"));
}
