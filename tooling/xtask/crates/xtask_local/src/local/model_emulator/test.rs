use super::*;

fn env_with_key(key: &str) -> BTreeMap<String, String> {
    BTreeMap::from([(API_KEY_VAR.to_string(), key.to_string())])
}

#[test]
fn the_emulator_stands_in_only_where_no_real_gemini_key_is_configured() {
    assert!(stands_in(Mode::Local, &env_with_key(PLACEHOLDER_API_KEY)));
    assert!(stands_in(Mode::Local, &BTreeMap::new()));
    assert!(!stands_in(Mode::Local, &env_with_key("AIza-real")));
    // `run-dev` talks to the hosted services, which only know real Gemini.
    assert!(!stands_in(Mode::Dev, &env_with_key(PLACEHOLDER_API_KEY)));
}

#[test]
fn the_model_router_is_sent_to_the_emulator_on_the_services_network() {
    assert_eq!(
        env()["OVERRIDE_GOOGLE_GENERATIVE_AI_API_URL"],
        "http://model-emulator:8080"
    );

    let instance = Instance::derive(Some("agent-a"), Some(20_000)).unwrap();
    assert_eq!(
        published_port(&instance),
        format!("{}:8080", instance.port(Port::ModelEmulator))
    );
}
