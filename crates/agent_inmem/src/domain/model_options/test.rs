use super::model_config_options;
use agent_fold::domain::model_selection::model_selection;

#[test]
fn routed_options_use_house_names() {
    let options = model_config_options(
        "fireworks/kimi-k3",
        &["fireworks/kimi-k3", "anthropic/claude-sonnet-5-5"],
    );
    let selection = model_selection(&options).expect("a model select");
    assert_eq!(selection.current, "fireworks/kimi-k3");
    assert_eq!(
        selection
            .options
            .iter()
            .map(|model| (model.id.as_str(), model.name.as_str()))
            .collect::<Vec<_>>(),
        vec![
            ("fireworks/kimi-k3", "Kimi K3"),
            ("anthropic/claude-sonnet-5-5", "anthropic/claude-sonnet-5-5"),
        ]
    );
}

#[test]
fn speed_is_advertised_only_for_supported_models_with_current_value() {
    use agent::{ModelSpeed, ReasoningEffort};
    use agent_client_protocol::schema::v1::SessionConfigKind;
    for (model, speed) in [
        ("openai/gpt-6-astra", ModelSpeed::Ultrafast),
        ("openai/gpt-6.1-sol", ModelSpeed::Ultrafast),
        ("anthropic/claude-opus-5-5", ModelSpeed::Fast),
    ] {
        let options =
            super::session_config_options(model, &[model], ReasoningEffort::Default, speed);
        let option = options
            .iter()
            .find(|option| option.id.to_string() == "speed")
            .unwrap();
        let SessionConfigKind::Select(select) = &option.kind else {
            panic!("speed must be selectable")
        };
        assert_eq!(select.current_value.to_string(), speed.as_str());
    }
    assert!(
        super::speed_config_option("anthropic/claude-sonnet-5-5", ModelSpeed::Standard).is_none()
    );
}
