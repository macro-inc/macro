use super::*;

fn env_of(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

#[test]
fn the_emulator_stands_in_only_where_no_real_google_client_is_configured() {
    let placeholders = env_of(&[
        ("GOOGLE_CLIENT_ID", "local-google-client"),
        ("GOOGLE_CLIENT_SECRET_KEY", "local-google-client-secret"),
    ]);
    let real = env_of(&[
        ("GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com"),
        ("GOOGLE_CLIENT_SECRET_KEY", "GOCSPX-real"),
    ]);

    assert!(stands_in(Mode::Local, &placeholders));
    assert!(!stands_in(Mode::Local, &real));
    // `run-dev` uses the hosted FusionAuth, which only knows real Google.
    assert!(!stands_in(Mode::Dev, &placeholders));
}

#[test]
fn only_the_authorization_url_is_addressed_for_a_browser() {
    let instance = Instance::derive(Some("agent-a"), Some(20_000)).unwrap();
    let env = env(&instance);
    let port = instance.port(Port::GmailEmulator);

    assert_eq!(
        env["OVERRIDE_GOOGLE_OAUTH_AUTHORIZATION_URL"],
        format!("http://localhost:{port}/o/oauth2/v2/auth")
    );
    let in_network: Vec<&String> = env
        .iter()
        .filter(|(name, _)| name.starts_with("OVERRIDE_"))
        .filter(|(name, _)| *name != "OVERRIDE_GOOGLE_OAUTH_AUTHORIZATION_URL")
        .map(|(_, value)| value)
        .collect();
    assert_eq!(in_network.len(), 7);
    assert!(
        in_network
            .iter()
            .all(|url| url.starts_with("http://gmail-emulator:8080/")),
        "{in_network:?}"
    );

    // The emulator pushes calendar changes to the calendar service itself.
    assert_eq!(
        env["CALENDAR_WATCH_WEBHOOK_URL"],
        "http://calendar-service:8080/notifications"
    );
    assert!(!env["CALENDAR_WATCH_TOKEN"].is_empty());

    // FusionAuth's browser redirect and the Gmail link's agree.
    assert_eq!(
        idp(&instance).authorization_endpoint,
        env["OVERRIDE_GOOGLE_OAUTH_AUTHORIZATION_URL"]
    );
}
