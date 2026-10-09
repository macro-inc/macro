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
fn model_image_capability_survives_acp_projection() {
    let options = model_config_options(
        "fireworks/glm-5p3",
        &[
            "fireworks/glm-5p3",
            "fireworks/kimi-k3",
            "cerebras/gpt-oss-120b",
            "custom/model",
        ],
    );
    let models = model_selection(&options).unwrap().options;
    assert_eq!(
        models
            .iter()
            .map(|model| model.supports_images)
            .collect::<Vec<_>>(),
        vec![Some(false), Some(true), Some(false), None]
    );
    assert!(
        models[0]
            .description
            .as_deref()
            .unwrap()
            .contains("Text only")
    );
}
