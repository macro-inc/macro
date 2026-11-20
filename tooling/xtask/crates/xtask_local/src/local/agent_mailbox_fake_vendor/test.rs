use super::*;

fn env_with_key(key: &str) -> BTreeMap<String, String> {
    BTreeMap::from([(API_KEY_VAR.to_string(), key.to_string())])
}

#[test]
fn the_fake_stands_in_only_where_no_real_provider_key_is_configured() {
    assert!(stands_in(Mode::Local, &env_with_key(FAKE_API_KEY)));
    assert!(stands_in(Mode::Local, &BTreeMap::new()));
    assert!(!stands_in(Mode::Local, &env_with_key("dse_real")));
    assert!(!stands_in(Mode::Dev, &BTreeMap::new()));
}

#[test]
fn agent_mailboxes_are_sent_to_the_fake_on_the_services_network() {
    let env = env();
    assert_eq!(
        env["OVERRIDE_DEAD_SIMPLE_API_URL"],
        "http://agent-mailbox-fake-vendor:8080"
    );
    assert_eq!(env[API_KEY_VAR], FAKE_API_KEY);
}
