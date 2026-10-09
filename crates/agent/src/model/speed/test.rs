use super::*;

#[test]
fn premium_speeds_are_model_specific() {
    assert!(ModelSpeed::Ultrafast.supported("openai/gpt-6-astra"));
    assert!(ModelSpeed::Ultrafast.supported("openai/gpt-6.1-sol"));
    assert!(ModelSpeed::Fast.supported("anthropic/claude-opus-5-5"));
    for model in [
        "openai/gpt-6-sol",
        "anthropic/claude-sonnet-5-5",
        "google/gemini-3.8-flash",
    ] {
        assert!(!ModelSpeed::Fast.supported(model));
        assert!(!ModelSpeed::Ultrafast.supported(model));
        assert!(ModelSpeed::Standard.supported(model));
    }
}

#[test]
fn speed_preserves_reasoning_parameters() {
    let mut params = serde_json::json!({"reasoning": {"effort": "high"}});
    ModelSpeed::Ultrafast.apply("openai/gpt-6-astra", &mut params);
    assert_eq!(params["reasoning"]["effort"], "high");
    assert_eq!(params["service_tier"], "ultrafast");
    ModelSpeed::Standard.apply("openai/gpt-6-astra", &mut params);
    assert_eq!(params["service_tier"], "default");
}
