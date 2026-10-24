use super::*;

#[test]
fn keys_parse_only_for_their_own_provider() {
    let anthropic = ProviderApiKey::parse(ModelProvider::Anthropic, " \"sk-ant-api03-abc\"\n")
        .expect("pasted quotes and whitespace are stripped");
    assert_eq!(anthropic.expose(), "sk-ant-api03-abc");
    assert_eq!(anthropic.prefix(), "sk-ant-");

    let openai = ProviderApiKey::parse(ModelProvider::OpenAi, "sk-proj-abc")
        .expect("project keys are OpenAI keys");
    assert_eq!(openai.prefix(), "sk-");

    for (provider, rejected) in [
        (ModelProvider::Anthropic, ""),
        (ModelProvider::Anthropic, "sk-ant-"),
        (ModelProvider::Anthropic, "sk-proj-abc"),
        (ModelProvider::Anthropic, "grok_abc"),
        (ModelProvider::OpenAi, "sk-"),
        (ModelProvider::OpenAi, "sk-ant-api03-abc"),
        (ModelProvider::OpenAi, "crsr_abc"),
        (ModelProvider::OpenAi, "sk-two words"),
    ] {
        assert!(
            ProviderApiKey::parse(provider, rejected).is_err(),
            "{rejected:?} should be rejected for {provider:?}"
        );
    }
}

#[test]
fn a_key_never_prints_itself() {
    let key = ProviderApiKey::parse(ModelProvider::OpenAi, "sk-proj-secret").expect("valid");
    let printed = format!("{key:?}");
    assert!(
        !printed.contains("secret"),
        "Debug leaked the key: {printed}"
    );
}

#[test]
fn routed_models_name_the_provider_whose_key_pays_for_them() {
    assert_eq!(
        ModelProvider::of_model("anthropic/claude-opus-5-5"),
        Some(ModelProvider::Anthropic)
    );
    assert_eq!(
        ModelProvider::of_model("openai/gpt-6-astra"),
        Some(ModelProvider::OpenAi)
    );
    assert_eq!(ModelProvider::of_model("google/gemini-3.8-flash"), None);
    assert_eq!(ModelProvider::of_model("claude-opus-5-5"), None);
}
