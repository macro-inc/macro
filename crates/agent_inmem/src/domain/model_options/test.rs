use super::model_config_options;
use agent_fold::domain::model_selection::model_selection;

#[test]
fn routed_options_use_house_names() {
    let options = model_config_options(
        "fireworks/kimi-k3",
        &["fireworks/kimi-k3", "anthropic/claude-sonnet-5"],
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
            ("anthropic/claude-sonnet-5", "anthropic/claude-sonnet-5"),
        ]
    );
}
