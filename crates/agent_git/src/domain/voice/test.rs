use super::*;

#[test]
fn only_aura_two_models_parse() {
    let model = VoiceModel::parse("aura-2-thalia-en").unwrap();
    assert_eq!((model.voice(), model.language()), ("thalia", "en"));
    for invalid in [
        "",
        "aura-2-",
        "aura-2-thalia",
        "aura-2-thalia-eng",
        "aura-2-Thalia-en",
        "aura-2-tha1ia-en",
        "aura-1-thalia-en",
        "aura-2-thalia-en\n",
        &format!("aura-2-{}-en", "a".repeat(100)),
    ] {
        assert_eq!(
            VoiceModel::parse(invalid),
            Err(InvalidVoiceModel),
            "{invalid:?}"
        );
    }
}

#[test]
fn the_file_round_trips_and_refuses_invalid_models() {
    let config = VoiceConfig {
        model: VoiceModel::parse("aura-2-arcas-en").unwrap(),
    };
    let contents = config.to_file_contents().unwrap();
    assert_eq!(contents, "{\n  \"model\": \"aura-2-arcas-en\"\n}\n");
    assert_eq!(
        serde_json::from_str::<VoiceConfig>(&contents).unwrap(),
        config
    );
    assert!(serde_json::from_str::<VoiceConfig>(r#"{"model":"../../etc"}"#).is_err());
}
