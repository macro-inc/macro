use super::*;

fn env_of(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(name, value)| (name.to_string(), value.to_string()))
        .collect()
}

#[test]
fn the_emulator_stands_in_only_where_no_real_microsoft_client_is_configured() {
    let none = env_of(&[]);
    let emulated = env_of(&[("MICROSOFT_CLIENT_ID", "local-microsoft-client")]);
    let real = env_of(&[(
        "MICROSOFT_CLIENT_ID",
        "0195a000-0000-7000-8000-0000000c11e7",
    )]);

    assert!(stands_in(Mode::Local, &none));
    // A second resolve sees the client the first one wrote.
    assert!(stands_in(Mode::Local, &emulated));
    assert!(!stands_in(Mode::Local, &real));
    // `run-dev` uses the hosted FusionAuth, which only knows real Microsoft.
    assert!(!stands_in(Mode::Dev, &none));
}

#[test]
fn only_the_login_page_is_addressed_for_a_browser() {
    let instance = Instance::derive(Some("agent-a"), Some(20_000)).unwrap();
    let env = env(&instance);
    let port = instance.port(Port::OutlookEmulator);

    assert_eq!(
        env["OVERRIDE_MICROSOFT_LOGIN_PAGE_URL"],
        format!("http://localhost:{port}/")
    );
    assert_eq!(
        env["OVERRIDE_MICROSOFT_LOGIN_URL"],
        "http://outlook-emulator:8080/"
    );
    assert_eq!(
        env["OVERRIDE_MICROSOFT_GRAPH_URL"],
        "http://outlook-emulator:8080/v1.0/"
    );

    // FusionAuth discovers the page from the emulator, which is told the
    // same browser address the authentication service is.
    let command = command(&instance);
    let browser_url = command
        .iter()
        .position(|argument| argument == "--browser-url")
        .map(|flag| command[flag + 1].clone());
    assert_eq!(browser_url, Some(format!("http://localhost:{port}")));
    assert_eq!(idp().issuer, "http://outlook-emulator:8080/common/v2.0");
}
